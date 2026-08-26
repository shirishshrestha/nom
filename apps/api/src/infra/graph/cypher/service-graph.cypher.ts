import { GRAPH_NODES, GRAPH_RELS } from '../graph-labels';

/**
 * Atomic promotion of staged services into the graph: canonical grouping nodes,
 * service nodes, their attribute bags, and the document/vendor relationships.
 *
 * Per staged row:
 * - `CanonicalService`: the grouping node, MERGEd on `(canonicalName, vendorId,
 *   tenantId)`. `canonicalName` is normalized at the source (`normalizeCanonical`),
 *   so this exact-match key is collision-safe — no normalization here.
 *   `description`/`category` are set on create only.
 * - `Service`: the priced line, MERGEd on `(id, tenantId)`; marked `current=true`.
 * - `IS_A` → canonical, `DEFINES` ← document, `OFFERS` ← vendor (only when a vendor
 *   exists), `HAS_ATTRIBUTES` → the per-line attribute bag.
 *
 * Amendment chain — the new line supersedes prior CURRENT lines of the same
 * `(canonical, tierSlug)` from OTHER documents:
 * - `tierSlug` (normalized band key) makes differently-spelled bands match; the
 *   `IS_A` anchor scopes to one canonical+vendor, so untiered lines (null slug,
 *   matched as `''`) supersede correctly.
 * - priors are collected newest-first. `AMENDS` links only the newest
 *   (`priors[0..1]` — the first element, or nothing when empty) for a linear audit
 *   chain; `current`/`validTo` are closed out on EVERY stale prior, so a commit
 *   self-heals any pre-existing 2+ concurrent-flat-line corruption for the band.
 *   (Upstream `dedupeByBand` keeps each commit to one line per band, so this never
 *   collapses legitimately-distinct lines.)
 */
export const COMMIT_SERVICES_CYPHER = `
MATCH (d:${GRAPH_NODES.SourceDocument} {id:$documentId, tenantId:$tenantId})
OPTIONAL MATCH (v:${GRAPH_NODES.Vendor} {id:$vendorId, tenantId:$tenantId})
UNWIND $rows AS row
  MERGE (c:${GRAPH_NODES.CanonicalService} {canonicalName:row.canonicalName, vendorId:$vendorId, tenantId:$tenantId})
    ON CREATE SET c.description=row.canonicalDescription, c.category=row.category
  MERGE (s:${GRAPH_NODES.Service} {id:row.id, tenantId:$tenantId})
    ON CREATE SET s.createdAt=$now
    SET s.canonicalName=row.canonicalName, s.tier=row.tier, s.tierSlug=row.tierSlug,
        s.title=row.title, s.pricingContext=row.pricingContext, s.documentId=$documentId,
        s.attributeSet=$attributeSet, s.validFrom=$validFrom, s.validTo=$validTo,
        s.foundAt=row.foundAt, s.stagingId=$stagingId, s.stagingVersion=$version,
        s.current=true
  MERGE (s)-[:${GRAPH_RELS.IS_A}]->(c)
  MERGE (d)-[:${GRAPH_RELS.DEFINES}]->(s)
  FOREACH (_ IN CASE WHEN v IS NULL THEN [] ELSE [1] END | MERGE (v)-[:${GRAPH_RELS.OFFERS}]->(s))
  MERGE (s)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(a:${GRAPH_NODES.Attributes} {serviceId:row.id, tenantId:$tenantId})
    SET a += row.attributes, a.attributeSet=$attributeSet
  WITH d, v, c, s
  CALL {
    WITH c, s
    OPTIONAL MATCH (prior:${GRAPH_NODES.Service} {tenantId:$tenantId, current:true})-[:${GRAPH_RELS.IS_A}]->(c)
      WHERE prior.id <> s.id
        AND prior.documentId <> $documentId
        AND coalesce(prior.tierSlug, '') = coalesce(s.tierSlug, '')
    WITH prior ORDER BY prior.validFrom DESC, prior.createdAt DESC
    RETURN collect(prior) AS priors
  }
  FOREACH (p IN priors[0..1] |
    MERGE (s)-[:${GRAPH_RELS.AMENDS}]->(p))
  FOREACH (p IN priors |
    SET p.current=false, p.validTo=coalesce($validFrom,$now))
RETURN count(DISTINCT c) AS canonicalCount, count(DISTINCT s) AS serviceCount`;

/**
 * Wire cross-service pricing references detected at commit: each `PRICED_FROM` links a
 * just-committed Service to the CanonicalService its price derives from ("B = 40% of A"),
 * carrying the verbatim `relation` wording (interpreted at match time, never a fixed
 * factor). Run AFTER COMMIT_SERVICES_CYPHER so both the referencing Service and the
 * referenced CanonicalService (always in the same document, so MERGEd above) exist. The
 * referenced-canonical MATCH is fail-soft: a ref whose target is absent yields no edge
 * rather than an error. `referencedTierSlug` pins the referenced band when tiered.
 */
export const WIRE_PRICING_REFS_CYPHER = `
UNWIND $refs AS ref
  MATCH (s:${GRAPH_NODES.Service} {id:ref.serviceId, tenantId:$tenantId})
  MATCH (c:${GRAPH_NODES.CanonicalService} {canonicalName:ref.referencedCanonical, vendorId:$vendorId, tenantId:$tenantId})
  MERGE (s)-[r:${GRAPH_RELS.PRICED_FROM}]->(c)
    SET r.relation=ref.relation, r.referencedTierSlug=ref.referencedTierSlug
RETURN count(r) AS refCount`;

/**
 * Same-document amendment: when a committed service is edited, the edit is committed
 * as a NEW Service node (via COMMIT_SERVICES_CYPHER, `current=true`) and the node it
 * replaces is retired here. The commit Cypher's supersession is cross-document only
 * (`prior.documentId <> $documentId`), so an in-document edit can't self-supersede —
 * we do it explicitly by id-pair, which is also robust when a title edit shifts the
 * canonical (no `(canonicalName, tierSlug)` match needed).
 *
 * Per pair: link the new node ahead of the prior with `AMENDS` and close the prior
 * (`current=false`, `validTo`). Run AFTER COMMIT_SERVICES_CYPHER in the same edit.
 */
export const AMEND_SERVICES_CYPHER = `
UNWIND $amendments AS am
  MATCH (newS:${GRAPH_NODES.Service} {id:am.newId, tenantId:$tenantId})
  MATCH (priorS:${GRAPH_NODES.Service} {id:am.priorId, tenantId:$tenantId})
  MERGE (newS)-[:${GRAPH_RELS.AMENDS}]->(priorS)
  SET priorS.current=false, priorS.validTo=coalesce($validFrom,$now)
RETURN count(*) AS amended`;

/**
 * CURRENT (non-amended) services a vendor offers, grouped by canonical concept and
 * paginated over the canonicals: each group carries its child current-service (tier)
 * lines with their attribute bag. `current:false` rows (superseded by a later AMENDS)
 * are excluded. `attributeSet` is a whole-card scalar (same for every service by
 * vendor invariant), computed before the range-slice so it survives an out-of-range
 * page. `$offset`/`$limit` must be Neo4j Integers. A vendor with no current services
 * still returns one row: `page:[]`, `total:0`, `attributeSet:null`.
 *
 * `$q` (nullable) is a case-insensitive substring filter applied at the group
 * level — a group is kept whole when `$q` matches its canonicalName/description/
 * category or any child service's title/tier — so `total` and the page both
 * reflect it. `null` disables the filter.
 */
export const CURRENT_SERVICES_CYPHER = `
MATCH (v:${GRAPH_NODES.Vendor} {id:$vendorId, tenantId:$tenantId})-[:${GRAPH_RELS.OFFERS}]->(s:${GRAPH_NODES.Service} {current:true})-[:${GRAPH_RELS.IS_A}]->(c:${GRAPH_NODES.CanonicalService})
WHERE $documentIds IS NULL OR s.documentId IN $documentIds
OPTIONAL MATCH (s)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(a:${GRAPH_NODES.Attributes})
WITH c, s, a ORDER BY s.tier
WITH c, head(collect(s.attributeSet)) AS attributeSet, collect({
  id:s.id, title:s.title, tier:s.tier, tierSlug:s.tierSlug, pricingContext:s.pricingContext,
  canonicalName:s.canonicalName, canonicalDescription:c.description, category:c.category,
  validFrom:s.validFrom, validTo:s.validTo, attributes:properties(a)
}) AS services
ORDER BY c.canonicalName
WITH collect({ canonicalName:c.canonicalName, canonicalDescription:c.description,
               category:c.category, services:services }) AS allGroups,
     head(collect(attributeSet)) AS attributeSet
WITH [g IN allGroups WHERE $q IS NULL
       OR toLower(g.canonicalName) CONTAINS toLower($q)
       OR toLower(coalesce(g.canonicalDescription,'')) CONTAINS toLower($q)
       OR toLower(coalesce(g.category,'')) CONTAINS toLower($q)
       OR any(s IN g.services WHERE
            toLower(s.title) CONTAINS toLower($q)
            OR toLower(coalesce(s.tier,'')) CONTAINS toLower($q))
     ] AS groups, attributeSet
RETURN groups[$offset..$offset+$limit] AS page, size(groups) AS total, attributeSet`;

/**
 * CURRENT services for a vendor, scoped to a specific set of canonical names — the
 * canonicals a document's line items were actually BILLED_AS. Used by symbol
 * resolution, which only ever needs the matched canonicals' tiers, not the vendor's
 * whole rate card. Same group shape as CURRENT_SERVICES_CYPHER minus pagination.
 */
export const SERVICES_FOR_CANONICALS_CYPHER = `
MATCH (v:${GRAPH_NODES.Vendor} {id:$vendorId, tenantId:$tenantId})-[:${GRAPH_RELS.OFFERS}]->(s:${GRAPH_NODES.Service} {current:true})-[:${GRAPH_RELS.IS_A}]->(c:${GRAPH_NODES.CanonicalService})
WHERE c.canonicalName IN $canonicalNames
OPTIONAL MATCH (s)-[:${GRAPH_RELS.HAS_ATTRIBUTES}]->(a:${GRAPH_NODES.Attributes})
WITH c, s, a ORDER BY s.tier
WITH c, collect({
  id:s.id, title:s.title, tier:s.tier, tierSlug:s.tierSlug, pricingContext:s.pricingContext,
  canonicalName:s.canonicalName, canonicalDescription:c.description, category:c.category,
  validFrom:s.validFrom, validTo:s.validTo, attributes:properties(a)
}) AS services
ORDER BY c.canonicalName
RETURN collect({ canonicalName:c.canonicalName, canonicalDescription:c.description,
               category:c.category, services:services }) AS groups`;

/**
 * The DIRECT cross-service pricing references out of a set of canonicals — each current
 * Service under a named canonical, and the CanonicalService its price derives from
 * (PRICED_FROM), with the verbatim `relation`. Match-time symbol resolution walks these
 * one level at a time to build the transitive closure (cycle-guarded in app code), so a
 * line billed as a referencing service can be composed against the services it depends
 * on. Vendor-scoped via OFFERS so only this vendor's rate card is followed.
 */
export const PRICING_REFS_FOR_CANONICALS_CYPHER = `
MATCH (v:${GRAPH_NODES.Vendor} {id:$vendorId, tenantId:$tenantId})-[:${GRAPH_RELS.OFFERS}]->(s:${GRAPH_NODES.Service} {current:true})-[:${GRAPH_RELS.IS_A}]->(c1:${GRAPH_NODES.CanonicalService})
WHERE c1.canonicalName IN $canonicalNames
MATCH (s)-[r:${GRAPH_RELS.PRICED_FROM}]->(c2:${GRAPH_NODES.CanonicalService} {tenantId:$tenantId})
RETURN collect(DISTINCT {
  fromCanonical:c1.canonicalName, referencedCanonical:c2.canonicalName,
  relation:r.relation, referencedTierSlug:r.referencedTierSlug
}) AS edges`;

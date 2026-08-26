import { Injectable, Logger } from '@nestjs/common';
import { Neo4jService, int } from '@nom/neo4j';
import {
  AMEND_SERVICES_CYPHER,
  COMMIT_SERVICES_CYPHER,
  CURRENT_SERVICES_CYPHER,
  PRICING_REFS_FOR_CANONICALS_CYPHER,
  SERVICES_FOR_CANONICALS_CYPHER,
  WIRE_PRICING_REFS_CYPHER,
} from './cypher/service-graph.cypher';
import {
  getNullableString,
  getNumber,
  unwrapAttributeBag,
} from './graph-record';
import { GraphWriteError } from './graph-error';
import { deriveServiceModel } from './service-model';
import { CurrentServiceDto } from '@nom/dtos';
import type { PricingRef, ServiceModel } from '@nom/shared';

export interface ServiceGraphRow {
  id: string;
  canonicalName: string;
  canonicalDescription: string;
  category: string | null;
  tier: string | null;
  tierSlug: string | null;
  title: string;
  pricingContext: string;
  pricingRef: PricingRef | null; // cross-service pricing dependency → a PRICED_FROM edge
  foundAt: string | null;
  attributes: Record<string, string | number | null>;
}

// A single cross-service pricing dependency at match time: a referencing canonical, the
// canonical its price derives from, and the verbatim relationship wording (interpreted
// by the composition phase — never a fixed factor). `referencedTierSlug` pins the
// referenced band when tiered.
export interface PricingRefEdge {
  fromCanonical: string;
  referencedCanonical: string;
  relation: string;
  referencedTierSlug: string | null;
}

// One canonical concept with its child current-service (tier) lines.
export interface CanonicalServiceGroup {
  canonicalName: string;
  canonicalDescription: string | null;
  category: string | null;
  services: CurrentServiceDto[];
}

// A page of a vendor's committed rate card, grouped by canonical, plus the vendor's
// single attribute-set key (all services share it — domain invariant) and the total
// canonical count. `null` attributeSet / `0` total when the vendor has no committed
// services yet.
export interface PaginatedCurrentServices {
  groupedServices: CanonicalServiceGroup[];
  attributeSet: string | null;
  total: number;
}

export interface CommitServicesInput {
  tenantId: string;
  documentId: string;
  vendorId: string;
  attributeSet: string;
  validFrom: string | null;
  validTo: string | null;
  stagingId: string;
  version: number;
  now: string;
  rows: ServiceGraphRow[];
}

export interface CommitResult {
  canonicalCount: number;
  serviceCount: number;
}

// One in-document supersession: the edited service was re-committed as `newId`, so
// the node it replaces (`priorId`) is retired and linked via AMENDS.
export interface ServiceAmendment {
  newId: string;
  priorId: string;
}

export interface AmendServicesInput {
  tenantId: string;
  validFrom: string | null;
  now: string;
  amendments: ServiceAmendment[];
}

// Atomic promotion of reviewed services to the graph. FATAL by contract — the
// caller must let the error propagate so the document is not advanced. Throws
// when the write returns no record (which would otherwise mask a failure as 0).
@Injectable()
export class ServiceGraphRepository {
  private readonly logger = new Logger(ServiceGraphRepository.name);

  constructor(private readonly neo4j: Neo4jService) {}

  async commitServices(input: CommitServicesInput): Promise<CommitResult> {
    const records = await this.neo4j.write(COMMIT_SERVICES_CYPHER, {
      documentId: input.documentId,
      tenantId: input.tenantId,
      vendorId: input.vendorId,
      attributeSet: input.attributeSet,
      validFrom: input.validFrom,
      validTo: input.validTo,
      now: input.now,
      stagingId: input.stagingId,
      version: input.version,
      rows: input.rows,
    });

    const rec = records[0];
    if (!rec)
      throw new GraphWriteError(
        `Service commit for document ${input.documentId} returned no result`,
      );

    const result = {
      canonicalCount: getNumber(rec, 'canonicalCount'),
      serviceCount: getNumber(rec, 'serviceCount'),
    };
    // The aggregating RETURN always yields one {0,0} row even when the initial
    // SourceDocument MATCH found nothing — so a no-op write masquerades as success.
    // Assert every input row produced a Service node.
    if (input.rows.length > 0 && result.serviceCount !== input.rows.length)
      throw new GraphWriteError(
        `Service commit for document ${input.documentId} wrote ${result.serviceCount}/${input.rows.length} services`,
      );
    this.logger.debug(
      `graph commit doc=${input.documentId} services=${result.serviceCount} canonicals=${result.canonicalCount}`,
    );

    await this.wirePricingRefs(input);
    return result;
  }

  // Wire the PRICED_FROM edges for rows that carry a cross-service pricing reference.
  // Runs AFTER the main commit so both endpoints exist. MERGE-idempotent, same
  // re-runnable contract as commitServices; a no-ref commit is a no-op.
  private async wirePricingRefs(input: CommitServicesInput): Promise<void> {
    const refs = input.rows
      .filter((row) => row.pricingRef !== null)
      .map((row) => ({
        serviceId: row.id,
        referencedCanonical: row.pricingRef!.referencedCanonical,
        referencedTierSlug: row.pricingRef!.referencedTierSlug,
        relation: row.pricingRef!.relation,
      }));
    if (refs.length === 0) return;

    await this.neo4j.write(WIRE_PRICING_REFS_CYPHER, {
      tenantId: input.tenantId,
      vendorId: input.vendorId,
      refs,
    });
    this.logger.debug(
      `graph wired ${refs.length} pricing reference(s) doc=${input.documentId}`,
    );
  }

  // Retire the prior node of each edited service (current=false, validTo) and link the
  // new node ahead of it with AMENDS. Runs AFTER commitServices in the same edit, so
  // both nodes already exist. FATAL by contract — same as commit: let it propagate so
  // the doc is not advanced. Asserts every pair matched (a missing node ⇒ silent gap).
  async amendServices(input: AmendServicesInput): Promise<number> {
    if (input.amendments.length === 0) return 0;
    const records = await this.neo4j.write(AMEND_SERVICES_CYPHER, {
      tenantId: input.tenantId,
      validFrom: input.validFrom,
      now: input.now,
      amendments: input.amendments,
    });
    const rec = records[0];
    const amended = rec ? getNumber(rec, 'amended') : 0;
    if (amended !== input.amendments.length)
      throw new GraphWriteError(
        `Service amend matched ${amended}/${input.amendments.length} node pairs`,
      );
    this.logger.debug(`graph amend pairs=${amended}`);
    return amended;
  }

  // A page of a vendor's current (non-amended) services, grouped by canonical and
  // paginated over the canonicals (DB-level range-slice). Returns empty (no graph
  // round-trip) for an unknown vendor.
  async listCurrentForVendor(
    tenantId: string,
    vendorId: string | undefined,
    {
      limit,
      offset,
      documentIds,
      model,
      q,
    }: {
      limit: number;
      offset: number;
      documentIds?: string[];
      model?: ServiceModel;
      q?: string;
    },
  ): Promise<PaginatedCurrentServices> {
    if (!vendorId) return { groupedServices: [], attributeSet: null, total: 0 };
    // The model filter is derived in-process, so it can't be applied by the DB
    // range-slice: fetch every (file-filtered) group and paginate here instead.
    const sliceInDb = !model;
    const records = await this.neo4j.read(CURRENT_SERVICES_CYPHER, {
      vendorId,
      tenantId,
      documentIds: documentIds?.length ? documentIds : null,
      q: q?.trim() ? q.trim() : null,
      offset: int(sliceInDb ? offset : 0),
      limit: int(sliceInDb ? limit : Number.MAX_SAFE_INTEGER),
    });
    const rec = records[0];
    if (!rec) return { groupedServices: [], attributeSet: null, total: 0 };

    const page = (rec.get('page') as RawGroup[]) ?? [];
    const attributeSet = getNullableString(rec, 'attributeSet');
    let groupedServices = this.mapRawGroups(page);
    let total = getNumber(rec, 'total');

    if (!sliceInDb) {
      const matched = groupedServices.filter(
        (g) => g.services[0]?.model === model,
      );
      total = matched.length;
      groupedServices = matched.slice(offset, offset + limit);
    }

    this.logger.debug(
      `graph read current services vendor=${vendorId} groups=${groupedServices.length}/${total} offset=${offset} limit=${limit}`,
    );
    return { groupedServices, attributeSet, total };
  }

  // Rate-card tiers scoped to a specific set of canonical names — used by symbol
  // resolution, which only needs the canonicals a document's lines were BILLED_AS,
  // not the vendor's whole rate card. Returns [] for an unknown vendor or no names.
  async listServicesForCanonicals(
    tenantId: string,
    vendorId: string | undefined,
    canonicalNames: string[],
  ): Promise<CanonicalServiceGroup[]> {
    if (!vendorId || canonicalNames.length === 0) return [];
    const records = await this.neo4j.read(SERVICES_FOR_CANONICALS_CYPHER, {
      vendorId,
      tenantId,
      canonicalNames,
    });
    const rec = records[0];
    if (!rec) return [];
    const groupedServices = this.mapRawGroups(
      (rec.get('groups') as RawGroup[]) ?? [],
    );
    this.logger.debug(
      `graph read scoped services vendor=${vendorId} canonicals=${canonicalNames.length} groups=${groupedServices.length}`,
    );
    return groupedServices;
  }

  // The DIRECT PRICED_FROM edges out of a set of canonicals — one BFS level of the
  // cross-service pricing graph. The caller walks levels (cycle-guarded) to reach the
  // full closure, then loads all reached canonicals' tiers. Returns [] for an unknown
  // vendor or no names.
  async listPricingRefs(
    tenantId: string,
    vendorId: string | undefined,
    canonicalNames: string[],
  ): Promise<PricingRefEdge[]> {
    if (!vendorId || canonicalNames.length === 0) return [];
    const records = await this.neo4j.read(PRICING_REFS_FOR_CANONICALS_CYPHER, {
      vendorId,
      tenantId,
      canonicalNames,
    });
    const rec = records[0];
    if (!rec) return [];
    return (rec.get('edges') as PricingRefEdge[]) ?? [];
  }

  private mapRawGroups(groups: RawGroup[]): CanonicalServiceGroup[] {
    return groups.map((g) => {
      const rawServices = g.services ?? [];
      // One model per canonical group; stamped on every child line.
      const model = deriveServiceModel(rawServices);
      return {
        canonicalName: g.canonicalName,
        canonicalDescription: g.canonicalDescription ?? null,
        category: g.category ?? null,
        services: rawServices.map((s) => ({
          id: s.id,
          canonicalName: s.canonicalName,
          canonicalDescription: s.canonicalDescription ?? null,
          category: s.category ?? null,
          title: s.title,
          tier: s.tier ?? null,
          tierSlug: s.tierSlug ?? null,
          pricingContext: s.pricingContext,
          model,
          attributes: unwrapAttributeBag(s.attributes),
          validFrom: s.validFrom ?? null,
          validTo: s.validTo ?? null,
        })),
      };
    });
  }
}

// Shape of the collected `page` maps returned by CURRENT_SERVICES_CYPHER (raw, with
// wrapped Integers still inside each service's attribute bag).
interface RawGroup {
  canonicalName: string;
  canonicalDescription: string | null;
  category: string | null;
  services: Array<{
    id: string;
    canonicalName: string;
    canonicalDescription: string | null;
    category: string | null;
    title: string;
    tier: string | null;
    tierSlug: string | null;
    pricingContext: string;
    validFrom: string | null;
    validTo: string | null;
    attributes: Record<string, unknown> | null;
  }>;
}

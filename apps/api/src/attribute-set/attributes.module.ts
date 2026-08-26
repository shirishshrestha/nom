import { Global, Module } from '@nestjs/common';
import { AttributeSetRegistry } from './attribute-set.registry';

@Global()
@Module({
  providers: [AttributeSetRegistry],
  exports: [AttributeSetRegistry],
})
export class AttributeSetModule {}

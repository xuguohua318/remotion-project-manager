import {readFile} from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import {describe, expect, it} from 'vitest';
import type {JsonSchemaDocument, JsonSchemaProperty} from '../src/shared/types';

const sampleFor = (property: JsonSchemaProperty): unknown => {
  if (property.enum?.length) return property.enum[0];
  if (property.type === 'boolean') return true;
  if (property.type === 'string') return '';
  if (property.type === 'object') return {};
  if (property.type === 'array') return [];
  return property.minimum ?? 0;
};

describe('CoaxialOptics migration schema', () => {
  it('compiles and accepts a complete generated settings object', async () => {
    const schemaPath = path.resolve('assets/coaxial/remotion-manager.schema.json');
    const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as JsonSchemaDocument;
    const sample = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, property]) => [key, sampleFor(property)]));
    const validate = new Ajv2020({allErrors: true, strict: false, multipleOfPrecision: 8}).compile(schema as object);
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
  });
});

import { writeFile } from 'node:fs/promises';
import { StationQueryJsonSchema, StationDataJsonSchema } from '../../../packages/stations/src/index.js';
for (const [name, schema] of [['station-query',StationQueryJsonSchema],['station-data',StationDataJsonSchema]] as const) {
  await writeFile(`docs/verification/stations-runtime/${name}.schema.json`,JSON.stringify(schema,null,2)+'\n');
}

export {
  configSchemaUrl,
  createDefaultConfig,
  defaultConfig,
  documentationUrl,
  renderStarterConfig,
  starterConfig,
  type StarterConfigOptions,
} from './config/defaults.js';
export {
  configDirectoryOf,
  configPathOf,
  loadConfig,
  resolveConfigPaths,
  type LoadedConfig,
} from './config/load.js';
export { parseConfigJson, validateConfig } from './config/validation.js';

import { renderStarterConfig } from './config/defaults.js';

/** @deprecated Use renderStarterConfig({ full: true }). */
export const exampleConfig = renderStarterConfig({ full: true });

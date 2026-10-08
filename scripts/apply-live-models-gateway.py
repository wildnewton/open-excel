from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1))


chat = "src/taskpane/components/chat/chat-context.tsx"

replace_once(
    chat,
    '''import {\n  type AssistantMessage,\n  getModel,\n  getModels,\n  getProviders,\n  type Model,\n  streamSimple,\n  type Usage,\n} from "@mariozechner/pi-ai";''',
    '''import { type AssistantMessage, getProviders, type Model, streamSimple, type Usage } from "@mariozechner/pi-ai";''',
)

replace_once(
    chat,
    '''import { EXCEL_TOOLS } from "../../../lib/tools";''',
    '''import { EXCEL_TOOLS } from "../../../lib/tools";\nimport {\n  type ProviderConfig,\n  type ThinkingLevel,\n  isConfigReady,\n  loadSavedConfig,\n  saveConfig,\n} from "./config";\nimport { apiKeyForConfig, resolveConfiguredModel } from "./model-discovery";''',
)

replace_once(
    chat,
    '''export type ThinkingLevel = "none" | "low" | "medium" | "high";\n\nexport interface ProviderConfig {\n  provider: string;\n  apiKey: string;\n  model: string;\n  useProxy: boolean;\n  proxyUrl: string;\n  thinking: ThinkingLevel;\n  followMode: boolean;\n}\n\nexport interface SessionStats {''',
    '''export interface SessionStats {''',
)

replace_once(
    chat,
    '''const STORAGE_KEY = "openexcel-provider-config";\n\nfunction loadSavedConfig(): ProviderConfig | null {\n  try {\n    const saved = localStorage.getItem(STORAGE_KEY);\n    if (saved) {\n      const config = JSON.parse(saved);\n      if (config.proxyUrl === undefined) {\n        config.proxyUrl = "";\n      }\n      if (config.followMode === undefined) {\n        config.followMode = true; // Default to on\n      }\n      return config;\n    }\n  } catch {}\n  return null;\n}\n\n''',
    '''''',
)

replace_once(
    chat,
    '''function applyProxyToModel(model: Model<any>, config: ProviderConfig): Model<any> {\n  if (!config.useProxy || !config.proxyUrl || !model.baseUrl) return model;''',
    '''function applyProxyToModel(model: Model<any>, config: ProviderConfig): Model<any> {\n  if (config.mode !== "byok" || !config.useProxy || !config.proxyUrl || !model.baseUrl) return model;''',
)

replace_once(chat, '''  getModelsForProvider: (provider: string) => Model<any>[];\n''', '''''')

replace_once(
    chat,
    '''    const validConfig = saved?.provider && saved?.apiKey && saved?.model ? saved : null;''',
    '''    const validConfig = isConfigReady(saved) ? saved : null;''',
)

replace_once(
    chat,
    '''  const getModelsForProvider = useCallback((provider: string): Model<any>[] => {\n    try {\n      return getModels(provider as any);\n    } catch {\n      return [];\n    }\n  }, []);\n\n''',
    '''''',
)

replace_once(
    chat,
    '''      try {\n        baseModel = getModel(config.provider as any, config.model as any);\n        contextWindow = baseModel.contextWindow;\n      } catch {\n        return;\n      }''',
    '''      try {\n        baseModel = resolveConfiguredModel(config);\n        contextWindow = baseModel.contextWindow;\n      } catch (err) {\n        setState((prev) => ({\n          ...prev,\n          error: err instanceof Error ? err.message : "Unable to configure the selected model",\n        }));\n        return;\n      }''',
)

replace_once(
    chat,
    '''            apiKey: config.apiKey,''',
    '''            apiKey: apiKeyForConfig(config),''',
)

replace_once(
    chat,
    '''        setState((prev) => ({ ...prev, error: "Please configure your API key first" }));''',
    '''        setState((prev) => ({ ...prev, error: "Please configure a model first" }));''',
)

replace_once(
    chat,
    '''    if (saved?.provider && saved?.apiKey && saved?.model) {\n      setProviderConfig(saved);\n    }''',
    '''    if (isConfigReady(saved)) {\n      setProviderConfig(saved);\n    }''',
)

replace_once(
    chat,
    '''      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));''',
    '''      saveConfig(newConfig);''',
)

replace_once(chat, '''        getModelsForProvider,\n''', '''''')

interface = "src/taskpane/components/chat/chat-interface.tsx"
replace_once(
    interface,
    '''      <div className="flex items-center gap-1">\n        <span>{providerConfig.provider}</span>\n        <span className="text-(--chat-text-secondary)">{providerConfig.model}</span>''',
    '''      <div className="flex items-center gap-1">\n        {providerConfig.mode === "byok" && <span>{providerConfig.provider}</span>}\n        <span className="text-(--chat-text-secondary)">{providerConfig.model}</span>''',
)

webpack = "webpack.config.js"
replace_once(
    webpack,
    '''  const dev = options.mode === "development";\n  const config = {''',
    '''  const dev = options.mode === "development";\n  const openExcelMode = env?.openexcelMode === "gateway" ? "gateway" : "byok";\n  const config = {''',
)
replace_once(
    webpack,
    '''        __APP_VERSION__: JSON.stringify(require("./package.json").version),''',
    '''        __APP_VERSION__: JSON.stringify(require("./package.json").version),\n        __OPENEXCEL_MODE__: JSON.stringify(openExcelMode),''',
)

package = "package.json"
replace_once(
    package,
    '''    "build": "webpack --mode production",''',
    '''    "build": "webpack --mode production --env openexcelMode=byok",\n    "build:byok": "webpack --mode production --env openexcelMode=byok",\n    "build:gateway": "webpack --mode production --env openexcelMode=gateway",''',
)

Path("src/global.d.ts").write_text(
    'declare const __APP_VERSION__: string;\ndeclare const __OPENEXCEL_MODE__: "byok" | "gateway";\n'
)

const fs = require('fs');
const path = require('path');

class PluginManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.logger = runtime.logger;
    this.plugins = new Map();
    this.pluginDir = path.join(__dirname, '../plugins');
  }

  async onInit() {
    this.logger.info('Initializing Plugin Manager...');
    await this.loadPlugins();
  }

  async onShutdown() {
    this.logger.info('Unloading all plugins...');
    for (const [name, plugin] of this.plugins.entries()) {
      try {
        if (typeof plugin.onUnload === 'function') {
          await plugin.onUnload();
        }
        this.logger.info(`Plugin unloaded: ${name}`);
      } catch (err) {
        this.logger.error(`Error unloading plugin ${name}: ${err.message}`);
      }
    }
    this.plugins.clear();
  }

  async loadPlugins() {
    if (!fs.existsSync(this.pluginDir)) {
      fs.mkdirSync(this.pluginDir, { recursive: true });
    }

    const folders = fs.readdirSync(this.pluginDir).filter(f => {
      return fs.statSync(path.join(this.pluginDir, f)).isDirectory();
    });

    this.logger.info(`Found ${folders.length} plugin(s) to load.`);

    for (const folder of folders) {
      const pluginPath = path.join(this.pluginDir, folder);
      try {
        const PluginClass = require(pluginPath);
        const pluginInstance = new PluginClass(this.runtime);
        
        if (typeof pluginInstance.onLoad === 'function') {
          await pluginInstance.onLoad();
        }
        
        this.plugins.set(folder, pluginInstance);
        this.logger.info(`Successfully loaded plugin: ${folder}`);
        await this.runtime.eventBus.publish('PLUGIN_LOADED', { plugin: folder });
      } catch (err) {
        this.logger.error(`Failed to load plugin ${folder}: ${err.message}`);
      }
    }
  }

  getPlugin(name) {
    return this.plugins.get(name);
  }
}

module.exports = PluginManager;

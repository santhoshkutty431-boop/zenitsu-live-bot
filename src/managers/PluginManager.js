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

  listPluginNames() {
    return Array.from(this.plugins.keys());
  }

  async reloadPlugin(name) {
    const pluginPath = path.join(this.pluginDir, name);
    if (!fs.existsSync(pluginPath)) {
      throw new Error(`Plugin folder not found: ${name}`);
    }

    // Unload current instance if present
    const current = this.plugins.get(name);
    if (current && typeof current.onUnload === 'function') {
      try { await current.onUnload(); }
      catch (err) { this.logger.error(`Error unloading ${name}: ${err.message}`); }
    }

    // Un-register from command router so re-registration doesn't collide
    const router = this.runtime.getService('CommandRouter');
    if (router && router.commands) {
      // Best-effort: we don't track which commands each plugin owns, but the
      // Map.set() in registerCommand will overwrite existing entries on reload.
    }

    // Purge the require cache for the plugin folder (index.js + siblings)
    const resolved = require.resolve(pluginPath);
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(path.dirname(resolved))) {
        delete require.cache[key];
      }
    }

    // Reload
    const PluginClass = require(pluginPath);
    const instance = new PluginClass(this.runtime);
    if (typeof instance.onLoad === 'function') {
      await instance.onLoad();
    }
    this.plugins.set(name, instance);
    this.logger.info(`Plugin reloaded: ${name}`);
    await this.runtime.eventBus.publish('PLUGIN_RELOADED', { plugin: name });
    return instance;
  }
}

module.exports = PluginManager;

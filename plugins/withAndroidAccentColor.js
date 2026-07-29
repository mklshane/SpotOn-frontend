const { withAndroidColors, withAndroidStyles } = require("expo/config-plugins");

const BRAND = "#FF8A4C";

/**
 * Native Android widgets (e.g. the DateTimePicker calendar dialog used by
 * DateField) pull their accent from the app theme's colorAccent, which
 * AppCompat defaults to teal. Setting it to the SpotOn brand orange keeps
 * those system dialogs on-theme instead of clashing with the sunset palette.
 *
 * Applied in prebuild so it survives `expo prebuild --clean`.
 */
module.exports = function withAndroidAccentColor(config) {
  config = withAndroidColors(config, (config) => {
    const colors = config.modResults;
    colors.resources.color = colors.resources.color ?? [];
    const upsert = (name, value) => {
      const existing = colors.resources.color.find((c) => c.$.name === name);
      if (existing) existing._ = value;
      else colors.resources.color.push({ $: { name }, _: value });
    };
    upsert("colorPrimary", BRAND);
    upsert("colorAccent", BRAND);
    return config;
  });

  return withAndroidStyles(config, (config) => {
    const styles = config.modResults;
    const appTheme = styles.resources.style.find((s) => s.$.name === "AppTheme");
    if (appTheme) {
      const upsertItem = (name, value) => {
        appTheme.item = appTheme.item ?? [];
        const existing = appTheme.item.find((i) => i.$.name === name);
        if (existing) existing._ = value;
        else appTheme.item.push({ $: { name }, _: value });
      };
      upsertItem("colorAccent", "@color/colorAccent");
      upsertItem("colorControlActivated", "@color/colorAccent");
      upsertItem("colorControlNormal", "@color/colorAccent");
    }
    return config;
  });
};

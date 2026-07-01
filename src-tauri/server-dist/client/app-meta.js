export const APP_META = {
  name: "Rankwell",
  version: "0.1.0",
  license: "Apache-2.0",
  copyright: "ingeniousfrog",
  github: "https://github.com/ingeniousfrog/Rankwell",
};

const PANEL_TITLES = {
  about: "About Rankwell",
  help: "Help",
  license: "License",
};

export function initAppMeta() {
  const dialog = document.querySelector("#info-dialog");
  const closeButton = document.querySelector("#info-dialog-close");
  const title = document.querySelector("#info-dialog-title");
  const versionLabel = document.querySelector("#app-meta-version");
  const panels = [...document.querySelectorAll(".info-panel")];
  const triggers = [...document.querySelectorAll("[data-info-panel]")].filter(
    (node) => node.matches("button.app-meta-link"),
  );

  if (!dialog || !closeButton || !title) {
    return;
  }

  if (versionLabel) {
    versionLabel.textContent = `${APP_META.name} v${APP_META.version}`;
  }

  const showPanel = (panelId) => {
    panels.forEach((panel) => {
      const isActive = panel.dataset.infoPanel === panelId;
      panel.hidden = !isActive;
    });
    title.textContent = PANEL_TITLES[panelId] || "Rankwell";
  };

  const openPanel = (panelId) => {
    showPanel(panelId);
    if (!dialog.open) {
      dialog.showModal();
    }
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener("click", () => {
      openPanel(trigger.dataset.infoPanel);
    });
  });

  closeButton.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  dialog.addEventListener("close", () => {
    showPanel("about");
  });
}

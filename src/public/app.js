const state = {
  config: { workspaceDir: "", syncthing: { apiUrl: "", apiKey: "", folderId: "" } },
  prompts: { data: { categories: [], prompts: [] }, mtimeMs: 0 },
  library: { data: { resources: [] }, mtimeMs: 0 },
  aiSites: { data: { sites: [] }, mtimeMs: 0 },
  imageAssets: {
    characters: { data: { assets: [] }, mtimeMs: 0 },
    scenes: { data: { assets: [] }, mtimeMs: 0 }
  },
  assetUi: {
    characters: { style: "anime", era: "ancient", styleFilter: "", search: "", gender: "" },
    scenes: { style: "anime", era: "ancient", styleFilter: "", search: "" }
  },
  editingImageAssetType: "",
  editingImageAssetId: "",
  selectedImageAssetFile: null,
  selectedImageAssetUrl: "",
  previewImageAssetType: "",
  previewImageAssetId: "",
  imageAssetView: { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 },
  access: { currentUserId: "", adminConfigured: false, adminAuthenticated: false, deleteOverrideEnabled: false, sessionExpiresAt: "", serverTime: "", deleteWindowHours: 12 },
  serverTimeOffsetMs: 0,
  appVersion: "",
  editingPromptId: "",
  editingResourceId: "",
  editingAiSiteId: "",
  previewResourceId: "",
  previewPromptId: "",
  activePromptText: "",
  promptThumbView: { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 },
  resourceSearch: "",
  resourceSortField: "createdAt",
  resourceSortDirection: "desc",
  resourceVideoRemoved: false,
  pendingVideoFilename: "",
  pendingVideoUploadToken: "",
  pendingVideoUpload: null,
  resourceDialogSession: 0
};

const $ = (selector) => document.querySelector(selector);

document.addEventListener("DOMContentLoaded", async () => {
  bindNavigation();
  bindSettings();
  bindPrompts();
  bindResources();
  bindAiSites();
  bindImageAssets();
  await Promise.all([loadConfig(), loadAppVersion(), loadAccessStatus()]);
  await loadAll();
  window.setInterval(() => loadAccessStatus().catch(() => {}), 60_000);
});

function bindNavigation() {
  document.querySelectorAll(".nav-btn").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-btn").forEach((item) => item.classList.remove("active"));
      document.querySelectorAll(".page").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      $(`#page-${button.dataset.page}`).classList.add("active");
    });
  });
}

function bindSettings() {
  $("#saveWorkspaceBtn").addEventListener("click", async () => {
    state.config = await api("/api/config", {
      method: "POST",
      body: { workspaceDir: $("#workspaceDir").value }
    });
    renderConfigForm();
    renderWorkspaceStatus();
  });
  $("#initWorkspaceBtn").addEventListener("click", async () => {
    await api("/api/workspace/init", { method: "POST" });
    await loadAll();
  });
  $("#migrateWorkspaceBtn").addEventListener("click", async () => {
    const workspaceDir = $("#migrateWorkspaceDir").value.trim();
    if (!workspaceDir) {
      alert("请输入新的工作目录");
      return;
    }
    if (!confirm("将当前工作目录的数据复制到新目录，并在成功后切换过去。确定继续吗？")) return;
    state.config = await api("/api/workspace/migrate", {
      method: "POST",
      body: { workspaceDir }
    });
    renderConfigForm();
    $("#migrateWorkspaceDir").value = "";
    renderWorkspaceStatus();
    await loadAll();
  });
  $("#reloadAllBtn").addEventListener("click", () => reloadAllData($("#reloadAllBtn")));
  $("#globalReloadBtn").addEventListener("click", () => reloadAllData($("#globalReloadBtn")));
  $("#saveSyncSettingsBtn").addEventListener("click", saveSyncSettings);
  $("#checkSyncStatusBtn").addEventListener("click", checkSyncStatus);
  $("#scanSyncFolderBtn").addEventListener("click", scanSyncFolder);
  $("#pauseSyncBtn").addEventListener("click", () => updateSyncPaused(true));
  $("#resumeSyncBtn").addEventListener("click", () => updateSyncPaused(false));
  $("#openSyncthingBtn").addEventListener("click", openSyncthing);
  $("#saveCurrentUserBtn").addEventListener("click", saveCurrentUserId);
  $("#setupAdminBtn").addEventListener("click", setupAdmin);
  $("#loginAdminBtn").addEventListener("click", loginAdmin);
  $("#logoutAdminBtn").addEventListener("click", logoutAdmin);
  $("#changeAdminPasswordBtn").addEventListener("click", changeAdminPassword);
  $("#deleteOverrideToggle").addEventListener("change", updateDeleteOverride);
}

function bindPrompts() {
  $("#manageCategoriesBtn").addEventListener("click", () => $("#categoryDialog").showModal());
  $("#closeCategoryDialogBtn").addEventListener("click", () => $("#categoryDialog").close());
  $("#addCategoryBtn").addEventListener("click", async () => {
    const name = prompt("分类名称");
    if (!name) return;
    state.prompts.data.categories.push({ id: createId("cat"), name: name.trim() });
    await savePrompts();
  });
  $("#addPromptBtn").addEventListener("click", () => openPromptDialog());
  $("#cancelPromptBtn").addEventListener("click", () => $("#promptDialog").close("cancel"));
  $("#promptForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const existing = getPrompt(state.editingPromptId);
    const item = {
      id: state.editingPromptId || createId("prompt"),
      categoryId: $("#promptCategory").value,
      title: $("#promptTitle").value.trim() || "未命名提示词",
      text: $("#promptText").value,
      description: $("#promptDescription").value,
      thumbnailFilename: existing?.thumbnailFilename || "",
      updatedAt: new Date().toISOString()
    };
    const prompts = state.prompts.data.prompts.filter((promptItem) => promptItem.id !== item.id);
    prompts.unshift(item);
    state.prompts.data.prompts = prompts;
    await savePrompts();
    $("#promptDialog").close();
  });
  $("#promptCategoryFilter").addEventListener("change", renderPrompts);
  $("#closePromptThumbBtn").addEventListener("click", () => $("#promptThumbDialog").close());
  $("#choosePromptThumbBtn").addEventListener("click", () => openPromptThumbUploadDialog());
  $("#deletePromptThumbBtn").addEventListener("click", () => deletePromptThumbnail(state.previewPromptId));
  $("#closePromptThumbUploadBtn").addEventListener("click", () => $("#promptThumbUploadDialog").close());
  $("#closePromptTextBtn").addEventListener("click", () => $("#promptTextDialog").close());
  $("#copyPromptTextBtn").addEventListener("click", async () => {
    await navigator.clipboard.writeText(state.activePromptText || "");
  });
  $("#browsePromptThumbBtn").addEventListener("click", () => $("#promptThumbFileInput").click());
  $("#promptThumbFileInput").addEventListener("change", async () => {
    const file = $("#promptThumbFileInput").files[0];
    if (file) await uploadPromptThumbnailFile(file);
    $("#promptThumbFileInput").value = "";
  });
  bindPromptThumbDropZone();
  bindPromptThumbPreviewControls();
}

function bindAiSites() {
  $("#addAiSiteBtn").addEventListener("click", () => openAiSiteDialog());
  $("#cancelAiSiteBtn").addEventListener("click", () => $("#aiSiteDialog").close());
  $("#saveAiSiteBtn").addEventListener("click", saveAiSiteFromDialog);
  $("#aiSiteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await saveAiSiteFromDialog();
  });
  $("#deleteAiSiteBtn").addEventListener("click", async () => {
    const ids = Array.from(document.querySelectorAll("[data-ai-site-select]:checked")).map((item) => item.dataset.aiSiteSelect);
    if (!ids.length) {
      alert("请选择要删除的网址条目");
      return;
    }
    if (!await confirmDialog("确定删除选中的网址条目吗？")) return;
    state.aiSites.data.sites = state.aiSites.data.sites.filter((item) => !ids.includes(item.id));
    await saveAiSites();
  });
}

function bindImageAssets() {
  $("#addCharacterBtn").addEventListener("click", () => openImageAssetDialog("characters"));
  $("#addSceneBtn").addEventListener("click", () => openImageAssetDialog("scenes"));
  $("#characterSearch").addEventListener("input", () => {
    state.assetUi.characters.search = $("#characterSearch").value;
    renderImageAssetPage("characters");
  });
  $("#sceneSearch").addEventListener("input", () => {
    state.assetUi.scenes.search = $("#sceneSearch").value;
    renderImageAssetPage("scenes");
  });
  $("#characterGenderFilter").addEventListener("change", () => {
    state.assetUi.characters.gender = $("#characterGenderFilter").value;
    renderImageAssetPage("characters");
  });
  $("#characterStyleFilter").addEventListener("change", () => changeImageAssetStyle("characters", $("#characterStyleFilter").value));
  $("#sceneStyleFilter").addEventListener("change", () => changeImageAssetStyle("scenes", $("#sceneStyleFilter").value));
  $("#characterEraFilter").addEventListener("change", () => changeImageAssetEra("characters", $("#characterEraFilter").value));
  $("#sceneEraFilter").addEventListener("change", () => changeImageAssetEra("scenes", $("#sceneEraFilter").value));
  $("#browseImageAssetBtn").addEventListener("click", () => $("#imageAssetFileInput").click());
  $("#imageAssetFileInput").addEventListener("change", () => {
    const file = $("#imageAssetFileInput").files[0];
    if (file) selectImageAssetFile(file);
    $("#imageAssetFileInput").value = "";
  });
  $("#cancelImageAssetBtn").addEventListener("click", closeImageAssetDialog);
  $("#imageAssetDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    closeImageAssetDialog();
  });
  $("#imageAssetForm").addEventListener("submit", saveImageAssetFromDialog);
  bindImageAssetDropZone();
  $("#closeImageAssetPreviewBtn").addEventListener("click", () => $("#imageAssetPreviewDialog").close());
  $("#editImageAssetBtn").addEventListener("click", editPreviewedImageAsset);
  $("#deleteImageAssetBtn").addEventListener("click", deletePreviewedImageAsset);
  $("#copyImageAssetBtn").addEventListener("click", copyPreviewedImageAsset);
  $("#revealImageAssetBtn").addEventListener("click", revealPreviewedImageAsset);
  bindImageAssetPreviewControls();
}

function openAiSiteDialog(item = null) {
  state.editingAiSiteId = item?.id || "";
  $("#aiSiteDialog h2").textContent = item ? "编辑 AI 网站" : "新增 AI 网站";
  $("#aiSiteTitle").value = item?.title || "";
  $("#aiSiteUrl").value = item?.url || "";
  $("#aiSiteDialog").showModal();
}

async function saveAiSiteFromDialog() {
  if ($("#saveAiSiteBtn").disabled) return;
  const title = $("#aiSiteTitle").value.trim();
  const url = $("#aiSiteUrl").value.trim();
  if (!title || !url) {
    alert("请输入标题和网址");
    return;
  }
  $("#saveAiSiteBtn").disabled = true;
  try {
    const existing = state.aiSites.data.sites.find((item) => item.id === state.editingAiSiteId);
    const site = {
      id: state.editingAiSiteId || createId("site"),
      title,
      url: normalizeUrl(url),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.aiSites.data.sites = state.aiSites.data.sites.filter((item) => item.id !== site.id);
    state.aiSites.data.sites.unshift(site);
    await saveAiSites();
    $("#aiSiteDialog").close();
  } finally {
    $("#saveAiSiteBtn").disabled = false;
  }
}

function bindResources() {
  $("#addResourceBtn").addEventListener("click", () => openResourceDialog());
  $("#refreshLibraryBtn").addEventListener("click", refreshLibrary);
  $("#resourceSearch").addEventListener("input", () => {
    state.resourceSearch = $("#resourceSearch").value;
    renderLibrary();
  });
  $("#resourceSortField").addEventListener("change", () => {
    state.resourceSortField = $("#resourceSortField").value;
    renderLibrary();
  });
  $("#resourceSortDirection").addEventListener("change", () => {
    state.resourceSortDirection = $("#resourceSortDirection").value;
    renderLibrary();
  });
  $("#resourceVideoFile").addEventListener("change", async () => {
    await uploadSelectedResourceVideo().catch(() => {});
    renderResourceVideoStatus();
  });
  $("#removeResourceVideoBtn").addEventListener("click", async () => {
    await removeVideoFromDialog();
    $("#resourceVideoFile").value = "";
    renderResourceVideoStatus();
  });
  $("#resourceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if ($("#saveResourceBtn").disabled) return;
    $("#saveResourceBtn").disabled = true;
    try {
      await saveResourceFromDialog();
      $("#resourceDialog").close("saved");
    } finally {
      if ($("#resourceDialog").open) $("#saveResourceBtn").disabled = false;
    }
  });
  $("#cancelResourceBtn").addEventListener("click", cancelResourceDialog);
  $("#resourceDialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelResourceDialog();
  });
  $("#closeDetailBtn").addEventListener("click", () => $("#detailDialog").close());
  $("#copyDetailBtn").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#detailPrompt").value);
  });
  $("#saveDetailBtn").addEventListener("click", async () => {
    const resource = getResource(state.editingResourceId);
    if (!resource) return;
    resource.prompt = $("#detailPrompt").value;
    resource.description = $("#detailDescription").value;
    resource.updatedAt = new Date().toISOString();
    await saveLibrary();
    $("#detailDialog").close();
  });
  $("#closeVideoPlayerBtn").addEventListener("click", closeVideoPlayer);
  $("#videoPlayerDialog").addEventListener("close", closeVideoPlayer);
}

async function loadConfig() {
  state.config = await api("/api/config");
  renderConfigForm();
  renderWorkspaceStatus();
}

async function loadAppVersion() {
  const health = await api("/api/health");
  state.appVersion = health.version || "";
  $("#appVersion").textContent = state.appVersion ? `v${state.appVersion}` : "";
}

async function loadAll() {
  await Promise.allSettled([loadPrompts(), loadLibrary(), loadAiSites(), loadImageAssets("characters"), loadImageAssets("scenes")]);
}

async function reloadAllData(button) {
  if (button?.disabled) return;
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "读取中…";
  }
  try {
    await Promise.all([loadAll(), loadAccessStatus()]);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function loadPrompts() {
  state.prompts = await api("/api/prompts");
  renderPrompts();
}

async function loadLibrary() {
  state.library = await api("/api/library");
  renderLibrary();
}

async function loadAiSites() {
  state.aiSites = await api("/api/ai-sites");
  renderAiSites();
}

async function loadImageAssets(type) {
  state.imageAssets[type] = await api(`/api/assets/${type}`);
  renderImageAssetPage(type);
}

async function loadAccessStatus() {
  state.access = await api("/api/access/status");
  state.serverTimeOffsetMs = Date.parse(state.access.serverTime) - Date.now();
  renderAccessPanel();
  renderPermissionSensitiveViews();
}

async function refreshLibrary() {
  state.library = await api("/api/library/refresh", { method: "POST" });
  renderLibrary();
}

function renderWorkspaceStatus() {
  $("#workspaceStatus").textContent = state.config.workspaceDir ? `同步目录：${state.config.workspaceDir}` : "未设置同步目录";
}

function renderConfigForm() {
  $("#workspaceDir").value = state.config.workspaceDir || "";
  $("#syncthingApiUrl").value = state.config.syncthing?.apiUrl || "http://127.0.0.1:8384";
  $("#syncthingApiKey").value = state.config.syncthing?.apiKey || "";
  $("#syncthingFolderId").value = state.config.syncthing?.folderId || "";
}

function renderAccessPanel() {
  const access = state.access;
  $("#currentUserId").value = access.currentUserId || "";
  $("#identityStatus").textContent = access.currentUserId
    ? `当前身份：${access.currentUserId}。修改身份需要管理员登录。`
    : "尚未设置用户 ID，不能新增内容。";
  $("#adminSetupArea").hidden = access.adminConfigured;
  $("#adminLoginArea").hidden = !access.adminConfigured || access.adminAuthenticated;
  $("#adminSessionArea").hidden = !access.adminAuthenticated;
  $("#deleteOverrideToggle").checked = Boolean(access.deleteOverrideEnabled);
  $("#deleteOverrideToggle").disabled = !access.adminAuthenticated;
  const expiresAt = Date.parse(access.sessionExpiresAt);
  $("#adminSessionStatus").textContent = access.adminAuthenticated && Number.isFinite(expiresAt)
    ? `已登录，会话约在 ${new Date(expiresAt).toLocaleTimeString()} 失效。`
    : "";
  $("#accessStatusMessage").textContent = access.deleteOverrideEnabled
    ? "管理员删除权限已开启：所有受保护内容均可删除。"
    : "普通规则：仅能删除自己创建未满 12 小时的内容。";
}

async function saveCurrentUserId() {
  await api("/api/access/identity", { method: "POST", body: { userId: $("#currentUserId").value } });
  state.config = await api("/api/config");
  await loadAccessStatus();
}

async function setupAdmin() {
  await api("/api/admin/setup", {
    method: "POST",
    body: { username: $("#adminSetupUsername").value, password: $("#adminSetupPassword").value }
  });
  $("#adminSetupPassword").value = "";
  await loadAccessStatus();
}

async function loginAdmin() {
  await api("/api/admin/login", {
    method: "POST",
    body: { username: $("#adminLoginUsername").value, password: $("#adminLoginPassword").value }
  });
  $("#adminLoginPassword").value = "";
  await loadAccessStatus();
}

async function logoutAdmin() {
  await api("/api/admin/logout", { method: "POST" });
  await loadAccessStatus();
}

async function changeAdminPassword() {
  await api("/api/admin/password", { method: "POST", body: { password: $("#adminNewPassword").value } });
  $("#adminNewPassword").value = "";
  $("#accessStatusMessage").textContent = "管理员密码已修改。";
}

async function updateDeleteOverride() {
  const enabled = $("#deleteOverrideToggle").checked;
  try {
    await api("/api/admin/delete-override", { method: "POST", body: { enabled } });
  } finally {
    await loadAccessStatus();
  }
}

function renderPermissionSensitiveViews() {
  setCreateControls();
  renderPrompts();
  renderLibrary();
  renderAiSites();
  renderImageAssetPage("characters");
  renderImageAssetPage("scenes");
  updateImageAssetPreviewPermissions();
  if ($("#categoryDialog").open) renderCategoryManagement();
  if ($("#promptThumbDialog").open) updatePromptThumbnailDeletePermission();
  if ($("#resourceDialog").open) renderResourceVideoStatus();
}

function setCreateControls() {
  const disabled = !state.access.currentUserId;
  const reason = disabled ? "请先在设置中填写本机用户 ID" : "";
  ["#addPromptBtn", "#addCategoryBtn", "#addResourceBtn", "#refreshLibraryBtn", "#addAiSiteBtn", "#addCharacterBtn", "#addSceneBtn"].forEach((selector) => {
    const button = $(selector);
    button.disabled = disabled;
    button.title = reason;
  });
}

function getDeletePermission(item) {
  if (state.access.deleteOverrideEnabled) return { allowed: true, reason: "管理员删除权限已开启" };
  if (!state.access.currentUserId) return { allowed: false, reason: "请先在设置中填写本机用户 ID" };
  if (!item?.createdBy || !Number.isFinite(Date.parse(item?.createdAt))) return { allowed: false, reason: "旧数据仅管理员可以删除" };
  if (item.createdBy !== state.access.currentUserId) return { allowed: false, reason: `由 ${item.createdBy} 创建，仅管理员可以删除` };
  const age = Date.now() + state.serverTimeOffsetMs - Date.parse(item.createdAt);
  if (age < 0 || age >= 12 * 60 * 60 * 1000) return { allowed: false, reason: "创建已满 12 小时，仅管理员可以删除" };
  return { allowed: true, reason: "可删除" };
}

function applyDeletePermission(button, item) {
  const permission = getDeletePermission(item);
  button.disabled = !permission.allowed;
  button.title = permission.reason;
}

async function saveSyncSettings() {
  state.config = await api("/api/config", {
    method: "POST",
    body: {
      syncthing: {
        apiUrl: $("#syncthingApiUrl").value,
        apiKey: $("#syncthingApiKey").value,
        folderId: $("#syncthingFolderId").value
      }
    }
  });
  renderConfigForm();
  $("#syncStatus").textContent = "同步设置已保存";
}

async function checkSyncStatus() {
  const status = await api("/api/syncthing/status");
  const folder = status.folder;
  const folderText = folder
    ? `文件夹状态：${folder.state || "未知"}，本地文件：${folder.localFiles ?? "-"}`
    : "未填写文件夹 ID";
  $("#syncStatus").textContent = `Syncthing 已连接。${folderText}`;
}

async function scanSyncFolder() {
  await api("/api/syncthing/scan", { method: "POST" });
  $("#syncStatus").textContent = "已请求 Syncthing 扫描同步文件夹";
}

async function updateSyncPaused(paused) {
  await api(`/api/syncthing/${paused ? "pause" : "resume"}`, { method: "POST" });
  $("#syncStatus").textContent = paused ? "已请求暂停同步" : "已请求恢复同步";
}

async function openSyncthing() {
  $("#syncStatus").textContent = "正在启动 Syncthing...";
  await api("/api/syncthing/open", { method: "POST" });
  const apiUrl = $("#syncthingApiUrl").value.trim() || "http://127.0.0.1:8384";
  $("#syncStatus").textContent = "已尝试启动 Syncthing，正在打开管理页面";
  window.open(apiUrl, "_blank", "noopener");
}

function renderPrompts() {
  const categories = state.prompts.data.categories;
  const filter = $("#promptCategoryFilter");
  const selected = filter.value;
  filter.innerHTML = `<option value="">全部分类</option>${categories.map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`).join("")}`;
  filter.value = selected;
  renderCategoryManagement();
  const activeCategory = filter.value;
  const prompts = state.prompts.data.prompts.filter((item) => !activeCategory || item.categoryId === activeCategory);
  $("#promptList").innerHTML = `
    <div class="prompt-tabs">
      <button class="${!activeCategory ? "active" : ""}" data-filter-category="">全部</button>
      ${categories.map((cat) => `<button class="${activeCategory === cat.id ? "active" : ""}" data-filter-category="${cat.id}">${escapeHtml(cat.name)}</button>`).join("")}
    </div>
    <div class="prompt-table">
      ${prompts.map((item) => `
        <div class="prompt-row sortable-row" draggable="true" data-sort-id="${item.id}">
          <div class="prompt-name" title="${escapeHtml(item.title)}">${escapeHtml(item.title || "未命名")}</div>
          <button class="prompt-text" data-preview-prompt-text="${item.id}">${escapeHtml(item.text || "")}</button>
          <div class="prompt-thumb-cell">
            <button class="prompt-thumb-button" data-preview-prompt-thumb="${item.id}">
              ${item.thumbnailFilename
                ? `<img src="/media/thumb/${encodeURIComponent(item.thumbnailFilename)}" alt="${escapeHtml(item.title)}" />`
                : `<span>缩略图</span>`}
            </button>
          </div>
          <div class="prompt-actions">
            <button data-edit-prompt="${item.id}">编辑</button>
            <button data-delete-prompt="${item.id}">删除</button>
          </div>
        </div>
      `).join("") || `<p class="empty-state">没有提示词</p>`}
    </div>
  `;
  bindPromptListActions();
  bindSortableList($(".prompt-table"), ".prompt-row[data-sort-id]", async (orderedIds) => {
    state.prompts.data.prompts = reorderVisibleItems(state.prompts.data.prompts, orderedIds);
    await savePrompts();
  });
}

function renderCategoryManagement() {
  const categories = state.prompts.data.categories;
  $("#categoryList").innerHTML = categories.map((cat) => `
    <div class="category-item">
      <strong>${escapeHtml(cat.name)}</strong>
      <div class="card-actions">
        <button data-rename-category="${cat.id}">重命名</button>
        <button data-delete-category="${cat.id}">删除</button>
      </div>
    </div>
  `).join("") || `<p class="empty-state">暂无分类</p>`;
}

function bindPromptListActions() {
  document.querySelectorAll("[data-filter-category]").forEach((button) => {
    button.addEventListener("click", () => {
      $("#promptCategoryFilter").value = button.dataset.filterCategory;
      renderPrompts();
    });
  });
  document.querySelectorAll("[data-copy-prompt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const item = getPrompt(button.dataset.copyPrompt);
      if (item) await navigator.clipboard.writeText(item.text);
    });
  });
  document.querySelectorAll("[data-edit-prompt]").forEach((button) => {
    button.addEventListener("click", () => openPromptDialog(getPrompt(button.dataset.editPrompt)));
  });
  document.querySelectorAll("[data-preview-prompt-text]").forEach((button) => {
    button.addEventListener("click", () => openPromptTextDialog(getPrompt(button.dataset.previewPromptText)));
  });
  document.querySelectorAll("[data-preview-prompt-thumb]").forEach((button) => {
    button.addEventListener("click", () => openPromptThumbPreview(getPrompt(button.dataset.previewPromptThumb)));
  });
  document.querySelectorAll("[data-delete-prompt]").forEach((button) => {
    applyDeletePermission(button, getPrompt(button.dataset.deletePrompt));
    button.addEventListener("click", async () => {
      if (!await confirmDialog("确定删除这个提示词吗？")) return;
      state.prompts.data.prompts = state.prompts.data.prompts.filter((item) => item.id !== button.dataset.deletePrompt);
      await savePrompts();
    });
  });
  document.querySelectorAll("[data-rename-category]").forEach((button) => {
    button.addEventListener("click", async () => {
      const category = state.prompts.data.categories.find((item) => item.id === button.dataset.renameCategory);
      const name = prompt("分类名称", category?.name || "");
      if (!category || !name) return;
      category.name = name.trim();
      await savePrompts();
    });
  });
  document.querySelectorAll("[data-delete-category]").forEach((button) => {
    applyDeletePermission(button, state.prompts.data.categories.find((item) => item.id === button.dataset.deleteCategory));
    button.addEventListener("click", async () => {
      if (!confirm("确定删除分类吗？分类下的提示词会保留，但不再归类。")) return;
      state.prompts.data.categories = state.prompts.data.categories.filter((item) => item.id !== button.dataset.deleteCategory);
      await savePrompts();
    });
  });
}

function openPromptThumbPreview(item) {
  if (!item) return;
  state.previewPromptId = item.id;
  resetPromptThumbView();
  const image = $("#promptThumbPreviewImg");
  if (item.thumbnailFilename) {
    image.src = `/media/thumb/${encodeURIComponent(item.thumbnailFilename)}`;
    image.alt = item.title || "提示词缩略图预览";
    image.hidden = false;
  } else {
    image.removeAttribute("src");
    image.hidden = true;
  }
  if (!$("#promptThumbDialog").open) $("#promptThumbDialog").showModal();
  updatePromptThumbnailDeletePermission();
}

function updatePromptThumbnailDeletePermission() {
  const item = getPrompt(state.previewPromptId);
  const button = $("#deletePromptThumbBtn");
  applyDeletePermission(button, item);
  if (!item?.thumbnailFilename) {
    button.disabled = true;
    button.title = "当前没有缩略图";
  }
}

function openPromptTextDialog(item) {
  if (!item) return;
  state.activePromptText = item.text || "";
  $("#promptTextDialogTitle").textContent = item.title || "提示词";
  $("#promptTextPreview").textContent = state.activePromptText;
  $("#promptTextDialog").showModal();
}

function openPromptThumbUploadDialog() {
  $("#promptThumbUploadDialog").showModal();
  $("#promptThumbDropZone").focus();
}

function bindPromptThumbDropZone() {
  const dropZone = $("#promptThumbDropZone");
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
    if (file) await uploadPromptThumbnailFile(file);
  });
  document.addEventListener("paste", async (event) => {
    if (!$("#promptThumbUploadDialog").open) return;
    const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith("image/"));
    if (file) {
      event.preventDefault();
      await uploadPromptThumbnailFile(file);
    }
  });
}

function bindPromptThumbPreviewControls() {
  const viewport = $("#promptThumbViewport");
  viewport.addEventListener("wheel", (event) => {
    if ($("#promptThumbPreviewImg").hidden) return;
    event.preventDefault();
    const delta = event.deltaY > 0 ? -0.1 : 0.1;
    state.promptThumbView.scale = Math.min(5, Math.max(0.3, state.promptThumbView.scale + delta));
    updatePromptThumbTransform();
  });
  viewport.addEventListener("mousedown", (event) => {
    if ($("#promptThumbPreviewImg").hidden) return;
    state.promptThumbView.dragging = true;
    state.promptThumbView.lastX = event.clientX;
    state.promptThumbView.lastY = event.clientY;
  });
  window.addEventListener("mousemove", (event) => {
    if (!state.promptThumbView.dragging) return;
    state.promptThumbView.x += event.clientX - state.promptThumbView.lastX;
    state.promptThumbView.y += event.clientY - state.promptThumbView.lastY;
    state.promptThumbView.lastX = event.clientX;
    state.promptThumbView.lastY = event.clientY;
    updatePromptThumbTransform();
  });
  window.addEventListener("mouseup", () => {
    state.promptThumbView.dragging = false;
  });
}

function resetPromptThumbView() {
  state.promptThumbView = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };
  updatePromptThumbTransform();
}

function updatePromptThumbTransform() {
  const view = state.promptThumbView;
  $("#promptThumbPreviewImg").style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

async function uploadPromptThumbnailFile(file) {
  if (!state.previewPromptId) return;
  const formData = new FormData();
  formData.append("thumbnail", file);
  const uploaded = await upload(`/api/prompts/${state.previewPromptId}/thumbnail`, formData);
  state.prompts = uploaded.prompts;
  $("#promptThumbUploadDialog").close();
  renderPrompts();
  openPromptThumbPreview(getPrompt(state.previewPromptId));
}

async function deletePromptThumbnail(promptId) {
  if (!promptId) return;
  const deleteThumbnailFile = confirm("是否删除同步目录中的缩略图文件？");
  state.prompts = await api(`/api/prompts/${promptId}/thumbnail`, {
    method: "DELETE",
    body: { deleteThumbnailFile }
  });
  renderPrompts();
  openPromptThumbPreview(getPrompt(promptId));
}

function renderPromptCategoryOptions() {
  $("#promptCategory").innerHTML = state.prompts.data.categories.map((cat) => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`).join("");
}

function openPromptDialog(item = null) {
  state.editingPromptId = item?.id || "";
  renderPromptCategoryOptions();
  $("#promptDialogTitle").textContent = item ? "编辑提示词" : "新增提示词";
  $("#promptTitle").value = item?.title || "";
  $("#promptCategory").value = item?.categoryId || state.prompts.data.categories[0]?.id || "";
  $("#promptText").value = item?.text || "";
  $("#promptDescription").value = item?.description || "";
  $("#promptDialog").showModal();
}

function renderLibrary() {
  const resources = sortResources(filterResources(state.library.data.resources));
  $("#videoGrid").innerHTML = resources.map((item) => {
    const thumb = renderResourceThumb(item);
    return `
      <article class="video-card" data-resource-card="${item.id}">
        <div class="thumb-wrap" data-play-resource="${item.id}">${thumb}</div>
        <h3>${escapeHtml(item.title || "未命名资源")}</h3>
        <p>${escapeHtml(excerpt(item.prompt || "", 90))}</p>
        <div class="card-actions">
          <button data-detail-resource="${item.id}">详情</button>
          <button data-edit-resource="${item.id}">编辑</button>
          <button data-delete-resource="${item.id}">删除</button>
        </div>
      </article>
    `;
  }).join("") || `<p class="empty-state">没有匹配的视频资源</p>`;
  bindResourceActions();
}

function sortResources(resources) {
  const field = state.resourceSortField;
  const direction = state.resourceSortDirection === "desc" ? -1 : 1;
  return [...resources].sort((a, b) => {
    const result = compareResourceValue(getSortValue(a, field), getSortValue(b, field), field);
    return result * direction;
  });
}

function getSortValue(item, field) {
  if (field === "createdAt" || field === "updatedAt") return item[field] || "";
  return item.title || "";
}

function compareResourceValue(a, b, field) {
  if (field === "createdAt" || field === "updatedAt") {
    return (Date.parse(a) || 0) - (Date.parse(b) || 0);
  }
  return String(a).localeCompare(String(b), "zh-Hans-CN", { numeric: true, sensitivity: "base" });
}

function bindResourceActions() {
  document.querySelectorAll("[data-play-resource]").forEach((wrap) => {
    const resource = getResource(wrap.dataset.playResource);
    wrap.addEventListener("mouseenter", () => {
      if (!resource?.videoFilename || wrap.dataset.hoverPlaying === "true") return;
      wrap.dataset.hoverPlaying = "true";
      wrap.innerHTML = `<video muted autoplay loop playsinline src="/media/video/${encodeURIComponent(resource.videoFilename)}"></video>`;
    });
    wrap.addEventListener("mouseleave", () => {
      if (!resource) return;
      wrap.dataset.hoverPlaying = "false";
      wrap.innerHTML = renderResourceThumb(resource);
    });
    wrap.addEventListener("click", () => openVideoPlayer(resource));
  });
  document.querySelectorAll("[data-detail-resource]").forEach((button) => {
    button.addEventListener("click", () => openDetailDialog(getResource(button.dataset.detailResource)));
  });
  document.querySelectorAll("[data-edit-resource]").forEach((button) => {
    button.addEventListener("click", () => openResourceDialog(getResource(button.dataset.editResource)));
  });
  document.querySelectorAll("[data-delete-resource]").forEach((button) => {
    applyDeletePermission(button, getResource(button.dataset.deleteResource));
    button.addEventListener("click", () => deleteResource(button.dataset.deleteResource));
  });
}

function filterResources(resources) {
  const query = state.resourceSearch.trim().toLowerCase();
  if (!query) return resources;
  return resources.filter((item) => {
    const searchable = [
      item.title,
      Array.isArray(item.tags) ? item.tags.join(" ") : "",
      item.prompt,
      item.description
    ].join(" ").toLowerCase();
    return searchable.includes(query);
  });
}

function renderResourceThumb(item) {
  if (item.thumbnailFilename) {
    return `<img src="/media/thumb/${encodeURIComponent(item.thumbnailFilename)}" alt="${escapeHtml(item.title)}" />`;
  }
  if (item.videoFilename) {
    return `<video muted preload="metadata" src="/media/video/${encodeURIComponent(item.videoFilename)}"></video>`;
  }
  return `<div class="thumb-placeholder">无视频</div>`;
}

function openDetailDialog(item) {
  if (!item) return;
  state.editingResourceId = item.id;
  $("#detailTitle").textContent = item.title || "资源详情";
  $("#detailPrompt").value = item.prompt || "";
  $("#detailDescription").value = item.description || "";
  $("#detailDialog").showModal();
}

function openVideoPlayer(item) {
  if (!item?.videoFilename) return;
  const dialog = $("#videoPlayerDialog");
  const player = $("#videoPlayer");
  player.src = `/media/video/${encodeURIComponent(item.videoFilename)}`;
  player.onloadedmetadata = () => {
    const maxWidth = window.innerWidth - 48;
    const maxHeight = window.innerHeight - 96;
    const videoWidth = player.videoWidth || 760;
    const videoHeight = player.videoHeight || Math.round(videoWidth * 9 / 16);
    const scale = Math.min(1, maxWidth / videoWidth, maxHeight / videoHeight);
    dialog.style.width = `${Math.round(videoWidth * scale)}px`;
  };
  dialog.showModal();
  player.play().catch(() => {});
}

function closeVideoPlayer() {
  const player = $("#videoPlayer");
  player.pause();
  player.removeAttribute("src");
  player.load();
  player.onloadedmetadata = null;
  $("#videoPlayerDialog").style.width = "";
  if ($("#videoPlayerDialog").open) $("#videoPlayerDialog").close();
}

function openResourceDialog(item = null) {
  state.resourceDialogSession += 1;
  state.editingResourceId = item?.id || "";
  state.resourceVideoRemoved = false;
  state.pendingVideoFilename = "";
  $("#resourceDialogTitle").textContent = item ? "编辑视频资源" : "新增视频资源";
  $("#resourceTitle").value = item?.title || "";
  $("#resourceTags").value = (item?.tags || []).join(", ");
  $("#resourcePrompt").value = item?.prompt || "";
  $("#resourceDescription").value = item?.description || "";
  $("#resourceVideoFile").value = "";
  renderResourceVideoStatus();
  $("#resourceDialog").showModal();
}

function renderResourceVideoStatus() {
  const file = $("#resourceVideoFile").files[0];
  const resource = getResource(state.editingResourceId);
  $("#saveResourceBtn").disabled = Boolean(state.pendingVideoUpload);
  $("#removeResourceVideoBtn").disabled = Boolean(state.pendingVideoUpload);
  const resourcePermission = getDeletePermission(resource);
  const hasVideo = Boolean(state.pendingVideoFilename || resource?.videoFilename);
  if (!hasVideo && !state.pendingVideoUpload) {
    $("#removeResourceVideoBtn").disabled = true;
    $("#removeResourceVideoBtn").title = "当前没有视频";
  } else if (resource?.videoFilename && !state.pendingVideoFilename && !state.pendingVideoUpload) {
    $("#removeResourceVideoBtn").disabled = !resourcePermission.allowed;
    $("#removeResourceVideoBtn").title = resourcePermission.reason;
  } else {
    $("#removeResourceVideoBtn").title = "";
  }
  if (state.pendingVideoUpload) {
    $("#resourceVideoStatus").textContent = `正在复制到同步目录：${file?.name || "视频文件"}`;
    return;
  }
  if (state.pendingVideoFilename) {
    $("#resourceVideoStatus").textContent = `已复制到同步目录：${state.pendingVideoFilename}`;
    return;
  }
  if (state.resourceVideoRemoved) {
    $("#resourceVideoStatus").textContent = "保存后将从资源记录中移除视频";
    return;
  }
  if (file) {
    $("#resourceVideoStatus").textContent = `正在复制到同步目录：${file.name}`;
    return;
  }
  $("#resourceVideoStatus").textContent = resource?.videoFilename ? `当前视频：${resource.videoFilename}` : "未选择视频";
}

async function uploadSelectedResourceVideo() {
  const videoFile = $("#resourceVideoFile").files[0];
  if (!videoFile) return;
  const dialogSession = state.resourceDialogSession;
  const previousPendingVideoFilename = state.pendingVideoFilename;
  const previousPendingVideoToken = state.pendingVideoUploadToken;
  state.pendingVideoFilename = "";
  state.pendingVideoUploadToken = "";
  state.resourceVideoRemoved = false;
  const uploadPromise = (async () => {
    const formData = new FormData();
    formData.append("video", videoFile);
    return upload("/api/resources/upload-video", formData);
  })();
  state.pendingVideoUpload = uploadPromise;
  renderResourceVideoStatus();
  try {
    const uploaded = await uploadPromise;
    if (dialogSession !== state.resourceDialogSession || !$("#resourceDialog").open) {
      await discardUploadedVideo(uploaded.filename, uploaded.uploadToken);
      return;
    }
    state.pendingVideoFilename = uploaded.filename;
    state.pendingVideoUploadToken = uploaded.uploadToken;
    if (previousPendingVideoFilename) await discardUploadedVideo(previousPendingVideoFilename, previousPendingVideoToken);
  } catch (error) {
    if (dialogSession === state.resourceDialogSession) $("#resourceVideoFile").value = "";
    throw error;
  } finally {
    if (state.pendingVideoUpload === uploadPromise) state.pendingVideoUpload = null;
    if (dialogSession === state.resourceDialogSession && $("#resourceDialog").open) renderResourceVideoStatus();
  }
}

function cancelResourceDialog() {
  const pendingFilename = state.pendingVideoFilename;
  const pendingToken = state.pendingVideoUploadToken;
  state.resourceDialogSession += 1;
  state.editingResourceId = "";
  state.resourceVideoRemoved = false;
  state.pendingVideoFilename = "";
  state.pendingVideoUploadToken = "";
  state.pendingVideoUpload = null;
  $("#resourceVideoFile").value = "";
  if ($("#resourceDialog").open) $("#resourceDialog").close("cancel");
  if (pendingFilename) {
    discardUploadedVideo(pendingFilename, pendingToken).catch((error) => console.warn("清理已取消的视频失败", error));
  }
}

async function removeVideoFromDialog() {
  if (state.pendingVideoUpload) {
    await state.pendingVideoUpload;
    state.pendingVideoUpload = null;
  }
  const resource = getResource(state.editingResourceId);
  const videoFilename = state.pendingVideoFilename || resource?.videoFilename || "";
  if (!videoFilename) {
    state.resourceVideoRemoved = true;
    return;
  }
  if (state.pendingVideoFilename) {
    await discardUploadedVideo(state.pendingVideoFilename, state.pendingVideoUploadToken);
    state.pendingVideoFilename = "";
    state.pendingVideoUploadToken = "";
  }
  state.resourceVideoRemoved = true;
}

async function saveResourceFromDialog() {
  if (state.pendingVideoUpload) {
    renderResourceVideoStatus();
    try {
      await state.pendingVideoUpload;
    } finally {
      state.pendingVideoUpload = null;
      renderResourceVideoStatus();
    }
  }
  const now = new Date().toISOString();
  const existingResource = getResource(state.editingResourceId);
  const resource = existingResource
    ? { ...existingResource }
    : { id: createId("res"), videoFilename: "", thumbnailFilename: "", createdAt: now };
  resource.title = $("#resourceTitle").value.trim() || "未命名资源";
  resource.tags = $("#resourceTags").value.split(",").map((tag) => tag.trim()).filter(Boolean);
  resource.prompt = $("#resourcePrompt").value;
  resource.description = $("#resourceDescription").value;
  resource.updatedAt = now;

  const pendingVideoFilename = state.pendingVideoFilename;
  let previousVideoFilename = "";
  if (pendingVideoFilename) {
    previousVideoFilename = resource.videoFilename;
    resource.videoFilename = pendingVideoFilename;
  } else if (state.resourceVideoRemoved) {
    previousVideoFilename = resource.videoFilename;
    resource.videoFilename = "";
  }

  await saveResourceWithConflictRetry(resource);
  state.pendingVideoFilename = "";
  state.pendingVideoUploadToken = "";
  state.resourceVideoRemoved = false;
  if (previousVideoFilename && previousVideoFilename !== resource.videoFilename) {
    const deletePreviousVideoFile = confirm("是否删除同步目录中的原视频？");
    if (deletePreviousVideoFile) {
      await api(`/api/resources/${resource.id}/unreferenced-video`, { method: "DELETE", body: { filename: previousVideoFilename } });
    }
  }
}

async function saveResourceWithConflictRetry(resource) {
  const save = async (silentCodes = []) => {
    const resources = state.library.data.resources.filter((item) => item.id !== resource.id);
    const existingIndex = state.library.data.resources.findIndex((item) => item.id === resource.id);
    if (existingIndex < 0) resources.unshift(resource);
    else resources.splice(existingIndex, 0, resource);
    state.library = await api("/api/library", {
      method: "PUT",
      body: { knownMtimeMs: state.library.mtimeMs, data: { ...state.library.data, resources } },
      silentCodes
    });
  };

  try {
    await save(["STALE_FILE"]);
  } catch (error) {
    if (error.code !== "STALE_FILE") throw error;
    state.library = await api("/api/library");
    await save();
  }
  renderLibrary();
}

async function discardUploadedVideo(filename, uploadToken) {
  await api("/api/resources/uploaded-video", {
    method: "DELETE",
    body: { filename, uploadToken }
  });
}

async function deleteResource(resourceId) {
  if (!await confirmDialog("确定删除这个视频资源记录吗？")) return;
  state.library = await api(`/api/resources/${resourceId}`, {
    method: "DELETE",
    body: { deleteVideoFile: true, deleteThumbnailFile: true }
  });
  renderLibrary();
}

const IMAGE_ASSET_TABS = [
  { style: "anime", era: "ancient", label: "动漫古代" },
  { style: "anime", era: "modern", label: "动漫现代" },
  { style: "live", era: "ancient", label: "真人古代" },
  { style: "live", era: "modern", label: "真人现代" }
];

function renderImageAssetPage(type) {
  const config = getImageAssetConfig(type);
  const ui = state.assetUi[type];
  const typeLabel = config.label;
  config.tabs.innerHTML = IMAGE_ASSET_TABS.map((tab) => `
    <button class="${tab.style === ui.style && tab.era === ui.era ? "active" : ""}"
      data-asset-tab-type="${type}" data-style="${tab.style}" data-era="${tab.era}">
      ${tab.label}${typeLabel}
    </button>
  `).join("");
  config.tabs.querySelectorAll("[data-asset-tab-type]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.style = button.dataset.style;
      ui.era = button.dataset.era;
      ui.styleFilter = ui.style;
      config.styleFilter.value = ui.styleFilter;
      config.eraFilter.value = ui.era;
      renderImageAssetPage(type);
    });
  });

  const query = ui.search.trim().toLowerCase();
  const assets = state.imageAssets[type].data.assets.filter((item) => {
    if (item.style !== ui.style || item.era !== ui.era) return false;
    if (type === "characters" && ui.gender && item.gender !== ui.gender) return false;
    if (!query) return true;
    return [item.title, ...(Array.isArray(item.tags) ? item.tags : [])].join(" ").toLowerCase().includes(query);
  });
  config.grid.innerHTML = assets.map((item) => `
    <button class="asset-card" data-image-asset-type="${type}" data-image-asset-id="${item.id}"
      title="${escapeHtml(item.title || "未命名资产")}" aria-label="预览${escapeHtml(item.title || "未命名资产")}">
      <img loading="lazy" src="${getImageAssetMediaUrl(type, item.imageFilename)}" alt="${escapeHtml(item.title || "图片资产")}" />
    </button>
  `).join("") || `<p class="empty-state">暂无${typeLabel}图片资产</p>`;
  config.grid.querySelectorAll("[data-image-asset-id]").forEach((button) => {
    button.addEventListener("click", () => openImageAssetPreview(type, button.dataset.imageAssetId));
    const image = button.querySelector("img");
    const updateOrientation = () => button.classList.toggle("portrait", image.naturalHeight > image.naturalWidth);
    image.addEventListener("load", updateOrientation, { once: true });
    if (image.complete && image.naturalWidth) updateOrientation();
  });
}

function getImageAssetConfig(type) {
  const character = type === "characters";
  return {
    label: character ? "人物" : "场景",
    tabs: $(character ? "#characterTabs" : "#sceneTabs"),
    grid: $(character ? "#characterGrid" : "#sceneGrid"),
    styleFilter: $(character ? "#characterStyleFilter" : "#sceneStyleFilter"),
    eraFilter: $(character ? "#characterEraFilter" : "#sceneEraFilter")
  };
}

function changeImageAssetStyle(type, style) {
  const ui = state.assetUi[type];
  ui.styleFilter = style;
  if (style) ui.style = style;
  renderImageAssetPage(type);
}

function changeImageAssetEra(type, era) {
  if (era) state.assetUi[type].era = era;
  renderImageAssetPage(type);
}

function getImageAsset(type, id) {
  return state.imageAssets[type]?.data.assets.find((item) => item.id === id);
}

function getImageAssetMediaUrl(type, filename) {
  return `/media/${type}/${encodeURIComponent(filename || "")}`;
}

function openImageAssetDialog(type, item = null) {
  const config = getImageAssetConfig(type);
  clearSelectedImageAssetFile();
  state.editingImageAssetType = type;
  state.editingImageAssetId = item?.id || "";
  $("#imageAssetDialogTitle").textContent = item ? `编辑${config.label}资产` : `新增${config.label}资产`;
  $("#imageAssetTitle").value = item?.title || "";
  $("#imageAssetTags").value = (item?.tags || []).join(", ");
  $("#imageAssetStyle").value = item?.style || "";
  $("#imageAssetEra").value = item?.era || "";
  $("#imageAssetGenderField").hidden = type !== "characters";
  $("#imageAssetGender").value = item?.gender || "";
  $("#imageAssetDropHint").textContent = item ? "拖入或粘贴新图片可替换原图" : "拖入图片或粘贴图片";
  const preview = $("#imageAssetSelectedPreview");
  if (item?.imageFilename) {
    preview.src = getImageAssetMediaUrl(type, item.imageFilename);
    preview.hidden = false;
  } else {
    preview.removeAttribute("src");
    preview.hidden = true;
  }
  $("#imageAssetDialog").showModal();
  $("#imageAssetDropZone").focus();
}

function closeImageAssetDialog() {
  if ($("#imageAssetDialog").open) $("#imageAssetDialog").close("cancel");
  clearSelectedImageAssetFile();
  state.editingImageAssetType = "";
  state.editingImageAssetId = "";
  $("#imageAssetSelectedPreview").removeAttribute("src");
  $("#imageAssetSelectedPreview").hidden = true;
}

function bindImageAssetDropZone() {
  const dropZone = $("#imageAssetDropZone");
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragging"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
    const file = Array.from(event.dataTransfer.files || []).find((item) => item.type.startsWith("image/"));
    if (file) selectImageAssetFile(file);
  });
  window.addEventListener("paste", (event) => {
    if (!$("#imageAssetDialog").open) return;
    const file = Array.from(event.clipboardData?.items || []).find((item) => item.type.startsWith("image/"))?.getAsFile();
    if (file) {
      event.preventDefault();
      selectImageAssetFile(file);
    }
  });
}

function selectImageAssetFile(file) {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
  if (!allowed.has(file.type)) {
    alert("仅支持 JPEG、PNG、WebP、GIF 或 AVIF 图片");
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    alert("图片不能超过 25MB");
    return;
  }
  clearSelectedImageAssetFile();
  state.selectedImageAssetFile = file;
  state.selectedImageAssetUrl = URL.createObjectURL(file);
  $("#imageAssetSelectedPreview").src = state.selectedImageAssetUrl;
  $("#imageAssetSelectedPreview").hidden = false;
  $("#imageAssetDropHint").textContent = `已选择：${file.name || "粘贴图片"}`;
  if (!$("#imageAssetTitle").value.trim()) {
    $("#imageAssetTitle").value = getImageAssetTitleFromFile(file);
  }
}

function getImageAssetTitleFromFile(file) {
  const filename = String(file?.name || "").trim();
  if (!filename) return "粘贴图片";
  const title = filename.replace(/\.[^.]+$/, "").trim();
  return title || "粘贴图片";
}

function clearSelectedImageAssetFile() {
  if (state.selectedImageAssetUrl) URL.revokeObjectURL(state.selectedImageAssetUrl);
  state.selectedImageAssetFile = null;
  state.selectedImageAssetUrl = "";
}

async function saveImageAssetFromDialog(event) {
  event.preventDefault();
  const type = state.editingImageAssetType;
  const id = state.editingImageAssetId;
  if (!type) return;
  if (!id && !state.selectedImageAssetFile) {
    alert("请拖入、粘贴或选择图片");
    return;
  }
  if (type === "characters" && !$("#imageAssetGender").value) {
    alert("请选择男或女");
    return;
  }
  const formData = new FormData();
  formData.append("title", $("#imageAssetTitle").value);
  formData.append("tags", $("#imageAssetTags").value);
  formData.append("style", $("#imageAssetStyle").value);
  formData.append("era", $("#imageAssetEra").value);
  if (type === "characters") formData.append("gender", $("#imageAssetGender").value);
  if (state.selectedImageAssetFile) formData.append("image", state.selectedImageAssetFile);
  $("#saveImageAssetBtn").disabled = true;
  try {
    const response = await upload(`/api/assets/${type}${id ? `/${id}` : ""}`, formData, id ? "PUT" : "POST");
    state.imageAssets[type] = response.collection;
    state.assetUi[type].style = response.asset.style;
    state.assetUi[type].era = response.asset.era;
    state.assetUi[type].styleFilter = response.asset.style;
    getImageAssetConfig(type).styleFilter.value = response.asset.style;
    getImageAssetConfig(type).eraFilter.value = response.asset.era;
    closeImageAssetDialog();
    renderImageAssetPage(type);
  } catch (error) {
    if (error.code === "EDIT_FORBIDDEN" || error.code === "STALE_FILE") await loadImageAssets(type);
  } finally {
    $("#saveImageAssetBtn").disabled = false;
  }
}

function openImageAssetPreview(type, id) {
  const item = getImageAsset(type, id);
  if (!item) return;
  state.previewImageAssetType = type;
  state.previewImageAssetId = id;
  resetImageAssetView();
  const image = $("#imageAssetPreviewImg");
  image.src = getImageAssetMediaUrl(type, item.imageFilename);
  image.alt = item.title || "图片资产预览";
  $("#imageAssetPreviewTitle").value = item.title || "未命名资产";
  updateImageAssetPreviewPermissions();
  $("#imageAssetPreviewDialog").showModal();
}

function updateImageAssetPreviewPermissions() {
  const item = getImageAsset(state.previewImageAssetType, state.previewImageAssetId);
  if (!item) return;
  const permission = getDeletePermission(item);
  for (const selector of ["#editImageAssetBtn", "#deleteImageAssetBtn"]) {
    $(selector).disabled = !permission.allowed;
    $(selector).title = permission.reason;
  }
}

async function copyPreviewedImageAsset() {
  const item = getImageAsset(state.previewImageAssetType, state.previewImageAssetId);
  if (!item) return;
  const button = $("#copyImageAssetBtn");
  const originalText = button.textContent;
  button.disabled = true;
  try {
    const response = await fetch(getImageAssetMediaUrl(state.previewImageAssetType, item.imageFilename));
    if (!response.ok) throw new Error("无法读取图片");
    await writeImageBlobToClipboard(await response.blob());
    button.textContent = "已复制";
    window.setTimeout(() => {
      if (button.textContent === "已复制") button.textContent = originalText;
    }, 1500);
  } catch (error) {
    alert(error?.message || "复制图片失败");
  } finally {
    button.disabled = false;
  }
}

async function writeImageBlobToClipboard(blob) {
  const ClipboardItemClass = window.ClipboardItem;
  if (!navigator.clipboard?.write || !ClipboardItemClass) throw new Error("当前浏览器不支持复制图片");
  const supportsOriginal = blob.type === "image/png"
    || (typeof ClipboardItemClass.supports === "function" && ClipboardItemClass.supports(blob.type));
  if (supportsOriginal) {
    try {
      await navigator.clipboard.write([new ClipboardItemClass({ [blob.type]: blob })]);
      return;
    } catch (error) {
      if (blob.type === "image/png") throw error;
    }
  }
  const pngBlob = await convertImageBlobToPng(blob);
  await navigator.clipboard.write([new ClipboardItemClass({ "image/png": pngBlob })]);
}

async function convertImageBlobToPng(blob) {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("无法转换图片格式")), { once: true });
      image.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    return await new Promise((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("无法转换图片格式")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function revealPreviewedImageAsset() {
  const type = state.previewImageAssetType;
  const item = getImageAsset(type, state.previewImageAssetId);
  if (!item) return;
  const button = $("#revealImageAssetBtn");
  button.disabled = true;
  try {
    await api(`/api/assets/${type}/${encodeURIComponent(item.id)}/reveal`, { method: "POST" });
  } finally {
    button.disabled = false;
  }
}

function editPreviewedImageAsset() {
  const item = getImageAsset(state.previewImageAssetType, state.previewImageAssetId);
  if (!item) return;
  const type = state.previewImageAssetType;
  $("#imageAssetPreviewDialog").close();
  openImageAssetDialog(type, item);
}

async function deletePreviewedImageAsset() {
  const type = state.previewImageAssetType;
  const item = getImageAsset(type, state.previewImageAssetId);
  if (!item || !await confirmDialog(`确定删除${getImageAssetConfig(type).label}资产“${item.title}”吗？`)) return;
  try {
    const response = await api(`/api/assets/${type}/${item.id}`, { method: "DELETE" });
    state.imageAssets[type] = response.collection;
    $("#imageAssetPreviewDialog").close();
    renderImageAssetPage(type);
  } catch (error) {
    if (error.code === "DELETE_FORBIDDEN" || error.code === "STALE_FILE") await loadImageAssets(type);
  }
}

function bindImageAssetPreviewControls() {
  const viewport = $("#imageAssetViewport");
  viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.12 : -0.12;
    state.imageAssetView.scale = Math.min(5, Math.max(0.3, state.imageAssetView.scale + delta));
    updateImageAssetTransform();
  }, { passive: false });
  viewport.addEventListener("mousedown", (event) => {
    state.imageAssetView.dragging = true;
    state.imageAssetView.lastX = event.clientX;
    state.imageAssetView.lastY = event.clientY;
  });
  window.addEventListener("mousemove", (event) => {
    if (!state.imageAssetView.dragging) return;
    state.imageAssetView.x += event.clientX - state.imageAssetView.lastX;
    state.imageAssetView.y += event.clientY - state.imageAssetView.lastY;
    state.imageAssetView.lastX = event.clientX;
    state.imageAssetView.lastY = event.clientY;
    updateImageAssetTransform();
  });
  window.addEventListener("mouseup", () => { state.imageAssetView.dragging = false; });
}

function resetImageAssetView() {
  state.imageAssetView = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };
  updateImageAssetTransform();
}

function updateImageAssetTransform() {
  const view = state.imageAssetView;
  $("#imageAssetPreviewImg").style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function renderAiSites() {
  $("#aiSiteList").innerHTML = state.aiSites.data.sites.map((item) => `
    <div class="ai-site-row sortable-row" draggable="true" data-sort-id="${item.id}">
      <label><input type="checkbox" data-ai-site-select="${item.id}" /></label>
      <div>${escapeHtml(item.title || "未命名")}</div>
      <div class="ai-site-url"><a href="${escapeHtml(item.url || "")}" target="_blank" rel="noopener">${escapeHtml(item.url || "")}</a></div>
      <div><button data-edit-ai-site="${item.id}">编辑</button></div>
    </div>
  `).join("") || `<p class="empty-state">暂无网址</p>`;
  document.querySelectorAll("[data-edit-ai-site]").forEach((button) => {
    button.addEventListener("click", () => {
      const site = state.aiSites.data.sites.find((item) => item.id === button.dataset.editAiSite);
      if (site) openAiSiteDialog(site);
    });
  });
  document.querySelectorAll("[data-ai-site-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", updateAiSiteDeleteButton);
  });
  updateAiSiteDeleteButton();
  bindSortableList($("#aiSiteList"), ".ai-site-row[data-sort-id]", async (orderedIds) => {
    state.aiSites.data.sites = reorderVisibleItems(state.aiSites.data.sites, orderedIds);
    await saveAiSites();
  });
}

function updateAiSiteDeleteButton() {
  const selectedIds = Array.from(document.querySelectorAll("[data-ai-site-select]:checked"), (item) => item.dataset.aiSiteSelect);
  const selectedItems = selectedIds.map((id) => state.aiSites.data.sites.find((item) => item.id === id)).filter(Boolean);
  const denied = selectedItems.map(getDeletePermission).find((permission) => !permission.allowed);
  const button = $("#deleteAiSiteBtn");
  button.disabled = !selectedItems.length || Boolean(denied);
  button.title = !selectedItems.length ? "请先选择要删除的网址" : denied?.reason || "删除选中网址";
}

function bindSortableList(container, itemSelector, onReorder) {
  if (!container) return;
  let draggedItem = null;
  let initialOrder = [];

  container.querySelectorAll(itemSelector).forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      draggedItem = item;
      initialOrder = Array.from(container.querySelectorAll(itemSelector), (row) => row.dataset.sortId);
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.dataset.sortId);
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      draggedItem = null;
    });
  });

  container.addEventListener("dragover", (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const target = event.target.closest(itemSelector);
    if (!target || target === draggedItem || target.parentElement !== container) return;
    const insertAfter = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
    container.insertBefore(draggedItem, insertAfter ? target.nextSibling : target);
  });

  container.addEventListener("drop", async (event) => {
    if (!draggedItem) return;
    event.preventDefault();
    const orderedIds = Array.from(container.querySelectorAll(itemSelector), (row) => row.dataset.sortId);
    if (orderedIds.some((id, index) => id !== initialOrder[index])) await onReorder(orderedIds);
  });
}

function reorderVisibleItems(items, orderedIds) {
  const orderedSet = new Set(orderedIds);
  const orderedItems = orderedIds.map((id) => items.find((item) => item.id === id)).filter(Boolean);
  let visibleIndex = 0;
  return items.map((item) => orderedSet.has(item.id) ? orderedItems[visibleIndex++] : item);
}

async function saveAiSites() {
  state.aiSites = await api("/api/ai-sites", {
    method: "PUT",
    body: { knownMtimeMs: state.aiSites.mtimeMs, data: state.aiSites.data }
  });
  renderAiSites();
}

async function savePrompts() {
  state.prompts = await api("/api/prompts", {
    method: "PUT",
    body: { knownMtimeMs: state.prompts.mtimeMs, data: state.prompts.data }
  });
  renderPrompts();
}

async function saveLibrary() {
  state.library = await api("/api/library", {
    method: "PUT",
    body: { knownMtimeMs: state.library.mtimeMs, data: state.library.data }
  });
  renderLibrary();
}

function getPrompt(id) {
  return state.prompts.data.prompts.find((item) => item.id === id);
}

function getResource(id) {
  return state.library.data.resources.find((item) => item.id === id);
}

function confirmDialog(message, title = "确认操作") {
  const dialog = $("#confirmDialog");
  $("#confirmDialogTitle").textContent = title;
  $("#confirmDialogMessage").textContent = message;
  return new Promise((resolve) => {
    const cleanup = () => {
      $("#confirmOkBtn").removeEventListener("click", handleOk);
      $("#confirmCancelBtn").removeEventListener("click", handleCancel);
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
    const closeWith = (value) => {
      dialog.returnValue = value ? "ok" : "cancel";
      if (dialog.open) dialog.close(dialog.returnValue);
    };
    const handleOk = () => closeWith(true);
    const handleCancel = (event) => {
      event?.preventDefault();
      closeWith(false);
    };
    const handleClose = () => {
      const confirmed = dialog.returnValue === "ok";
      cleanup();
      resolve(confirmed);
    };
    $("#confirmOkBtn").addEventListener("click", handleOk);
    $("#confirmCancelBtn").addEventListener("click", handleCancel);
    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    dialog.returnValue = "cancel";
    dialog.showModal();
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    if (!options.silentCodes?.includes(data.code)) alert(data.error || "操作失败");
    const error = new Error(data.error || "Request failed");
    error.code = data.code || "";
    throw error;
  }
  return data;
}

async function upload(url, formData, method = "POST") {
  const response = await fetch(url, { method, body: formData });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || "上传失败");
    const error = new Error(data.error || "Upload failed");
    error.code = data.code || "";
    throw error;
  }
  return data;
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeUrl(url) {
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function excerpt(text, length) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > length ? `${value.slice(0, length)}...` : value;
}

function escapeHtml(text) {
  return String(text || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

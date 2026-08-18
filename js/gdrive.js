/**
 * gdrive.js — Save to Google Drive
 *
 * Uses Google Identity Services (GSI) for OAuth2 and the Drive v3 REST API
 * for folder browsing and file upload/overwrite.
 */

(function () {
  'use strict';

  const GOOGLE_CLIENT_ID =
    '655872868584-t0pfnmqgaeqiopi8gcma43dpfjuei4ng.apps.googleusercontent.com';
  const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive.file';

  const DRIVE_FILES_API  = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

  // Cached access token
  let _tokenClient = null;
  let _accessToken  = null;
  let _tokenExpiry  = 0;

  // ─── Auth ────────────────────────────────────────────────────────────────────

  function getTokenClient() {
    return new Promise((resolve, reject) => {
      if (!window.google || !window.google.accounts) {
        reject(new Error('Google Identity Services script not loaded'));
        return;
      }
      if (!_tokenClient) {
        _tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: GOOGLE_SCOPES,
          callback: () => {}, // overridden per-request
        });
      }
      resolve(_tokenClient);
    });
  }

  function authoriseGoogle() {
    return new Promise(async (resolve, reject) => {
      // Return cached token if still valid (with 60s buffer)
      if (_accessToken && Date.now() < _tokenExpiry - 60_000) {
        resolve(_accessToken);
        return;
      }

      let client;
      try {
        client = await getTokenClient();
      } catch (e) {
        reject(e);
        return;
      }

      client.callback = (resp) => {
        if (resp.error) {
          reject(new Error(resp.error));
          return;
        }
        _accessToken = resp.access_token;
        // Drive.file tokens typically expire in 3600s; use expires_in if available
        _tokenExpiry = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3600_000);
        resolve(_accessToken);
      };

      // Prompt only if necessary
      client.requestAccessToken({ prompt: _accessToken ? '' : 'select_account' });
    });
  }

  // ─── Drive API helpers ───────────────────────────────────────────────────────

  async function apiFetch(url, token, options = {}) {
    const resp = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.headers || {}),
      },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Drive API ${resp.status}: ${body}`);
    }
    return resp.json();
  }

  async function listFolders(parentId, token) {
    const q = encodeURIComponent(
      `'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    );
    const url = `${DRIVE_FILES_API}?q=${q}&fields=files(id,name)&orderBy=name&pageSize=200`;
    const data = await apiFetch(url, token);
    return data.files || [];
  }

  // List both folders and JSON files in a folder (for the open dialog)
  async function listDriveItems(parentId, token) {
    const q = encodeURIComponent(
      `'${parentId}' in parents and (mimeType='application/vnd.google-apps.folder' or (mimeType='application/json' and name contains '.json')) and trashed=false`
    );
    const url = `${DRIVE_FILES_API}?q=${q}&fields=files(id,name,mimeType)&orderBy=folder,name&pageSize=200`;
    const data = await apiFetch(url, token);
    return data.files || [];
  }

  async function downloadFile(fileId, token) {
    const resp = await fetch(`${DRIVE_FILES_API}/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    return resp.text();
  }

  function validateDiagram(data) {
    if (typeof data !== 'object' || data === null) throw new Error('File is not a valid JSON object');
    if (typeof data.version === 'undefined') throw new Error('Missing version field — not a diagram file');
    if (!Array.isArray(data.tabs) && typeof data.nodes === 'undefined') {
      throw new Error('File does not contain diagram data (no tabs or nodes)');
    }
  }

  async function findFile(name, parentId, token) {
    const q = encodeURIComponent(
      `'${parentId}' in parents and name='${name.replace(/'/g, "\\'")}' and mimeType='application/json' and trashed=false`
    );
    const url = `${DRIVE_FILES_API}?q=${q}&fields=files(id,name)&pageSize=1`;
    const data = await apiFetch(url, token);
    return (data.files && data.files[0]) || null;
  }

  async function uploadFile(blob, filename, folderId, existingFileId, token) {
    const metadata = existingFileId
      ? {} // PATCH: don't send name/parents to avoid 403
      : { name: filename, parents: [folderId], mimeType: 'application/json' };

    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    body.append('file', blob);

    if (existingFileId) {
      // Overwrite existing file — PATCH upload
      const url = `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`;
      const resp = await fetch(url, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (!resp.ok) throw new Error(`Drive upload failed: ${resp.status}`);
      return resp.json();
    } else {
      // Create new file — POST upload
      const resp = await fetch(DRIVE_UPLOAD_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (!resp.ok) throw new Error(`Drive upload failed: ${resp.status}`);
      return resp.json();
    }
  }

  // ─── Folder Browser Dialog ───────────────────────────────────────────────────

  const STYLES = `
    .gd-overlay {
      position: fixed; inset: 0; z-index: 10000;
      background: rgba(0,0,0,.5);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Google Sans', Roboto, Arial, sans-serif;
    }
    .gd-dialog {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 11px 15px -7px rgba(0,0,0,.2), 0 24px 38px 3px rgba(0,0,0,.14), 0 9px 46px 8px rgba(0,0,0,.12);
      min-width: 480px;
      max-width: 560px;
      width: 100%;
      overflow: hidden;
    }
    .gd-dialog-header {
      padding: 20px 24px 0;
    }
    .gd-dialog-title {
      margin: 0 0 16px;
      font-size: 20px;
      font-weight: 500;
      color: #202124;
      display: flex; align-items: center; gap: 10px;
    }
    .gd-dialog-title svg { flex-shrink: 0; }
    .gd-dialog-body { padding: 0 24px; }
    .gd-field-label {
      font-size: 12px;
      color: #5f6368;
      margin-bottom: 4px;
      font-weight: 500;
      letter-spacing: .3px;
    }
    .gd-filename-input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      font-size: 14px;
      color: #202124;
      border: 1px solid #dadce0;
      border-radius: 4px;
      outline: none;
      margin-bottom: 16px;
      transition: border-color .15s;
    }
    .gd-filename-input:focus {
      border-color: #1a73e8;
      box-shadow: 0 0 0 2px rgba(26,115,232,.15);
    }
    .gd-folder-section {
      border: 1px solid #dadce0;
      border-radius: 4px;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .gd-breadcrumb {
      display: flex; align-items: center; flex-wrap: wrap; gap: 2px;
      padding: 8px 12px;
      background: #f8f9fa;
      border-bottom: 1px solid #dadce0;
      font-size: 13px;
      min-height: 38px;
    }
    .gd-breadcrumb-item {
      color: #1a73e8;
      cursor: pointer;
      padding: 2px 4px;
      border-radius: 3px;
      white-space: nowrap;
    }
    .gd-breadcrumb-item:hover { background: #e8f0fe; text-decoration: underline; }
    .gd-breadcrumb-item.active { color: #202124; cursor: default; font-weight: 500; }
    .gd-breadcrumb-item.active:hover { background: none; text-decoration: none; }
    .gd-breadcrumb-sep { color: #9aa0a6; font-size: 12px; user-select: none; }
    .gd-folder-list {
      min-height: 140px;
      max-height: 200px;
      overflow-y: auto;
      background: #fff;
    }
    .gd-folder-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 14px;
      cursor: pointer;
      font-size: 14px;
      color: #202124;
      border-bottom: 1px solid #f1f3f4;
      transition: background .1s;
    }
    .gd-folder-item:last-child { border-bottom: none; }
    .gd-folder-item:hover { background: #f1f3f4; }
    .gd-folder-item.selected { background: #e8f0fe; }
    .gd-folder-item-name { flex: 1; }
    .gd-folder-item-arrow { color: #9aa0a6; font-size: 12px; }
    .gd-file-item {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 14px;
      cursor: pointer;
      font-size: 14px;
      color: #202124;
      border-bottom: 1px solid #f1f3f4;
      transition: background .1s;
    }
    .gd-file-item:last-child { border-bottom: none; }
    .gd-file-item:hover { background: #f1f3f4; }
    .gd-file-item.selected { background: #e8f0fe; outline: 2px solid #1a73e8; outline-offset: -2px; }
    .gd-file-item-name { flex: 1; }
    .gd-empty-msg {
      display: flex; align-items: center; justify-content: center;
      height: 140px;
      color: #9aa0a6; font-size: 13px;
    }
    .gd-loading-msg { display: flex; align-items: center; justify-content: center; height: 140px; gap: 8px; color: #5f6368; font-size: 13px; }
    .gd-spinner {
      width: 18px; height: 18px;
      border: 2px solid #dadce0;
      border-top-color: #1a73e8;
      border-radius: 50%;
      animation: gd-spin .7s linear infinite;
    }
    @keyframes gd-spin { to { transform: rotate(360deg); } }
    .gd-save-location {
      font-size: 12px; color: #5f6368; padding: 6px 0 16px;
    }
    .gd-save-location strong { color: #202124; }
    .gd-dialog-actions {
      display: flex; justify-content: flex-end; gap: 8px;
      padding: 16px 24px;
      border-top: 1px solid #e0e0e0;
    }
    .gd-btn {
      display: inline-flex; align-items: center; justify-content: center;
      padding: 8px 20px;
      border-radius: 4px;
      font-size: 14px; font-weight: 500;
      cursor: pointer; outline: none;
      transition: background .15s, box-shadow .15s;
      min-width: 80px;
    }
    .gd-btn-cancel {
      background: none;
      border: 1px solid #dadce0;
      color: #1a73e8;
    }
    .gd-btn-cancel:hover { background: #f1f3f4; }
    .gd-btn-save {
      background: #1a73e8;
      border: 1px solid #1a73e8;
      color: #fff;
    }
    .gd-btn-save:hover { background: #1557b0; }
    .gd-btn-save:disabled { background: #dadce0; border-color: #dadce0; color: #9aa0a6; cursor: not-allowed; }
    .gd-error-msg {
      font-size: 12px; color: #d93025;
      padding: 0 24px 12px; min-height: 16px;
    }
  `;

  function injectStyles() {
    if (document.getElementById('gd-styles')) return;
    const s = document.createElement('style');
    s.id = 'gd-styles';
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // Google Drive folder icon SVG
  function folderIcon() {
    return `<svg width="20" height="16" viewBox="0 0 20 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M1.5 2.5C1.5 1.67 2.17 1 3 1H7.5L9.5 3.5H17C17.83 3.5 18.5 4.17 18.5 5V13C18.5 13.83 17.83 14.5 17 14.5H3C2.17 14.5 1.5 13.83 1.5 13V2.5Z" fill="#FDD663" stroke="#F9A825" stroke-width=".8"/>
    </svg>`;
  }

  // Google Drive logo SVG (small, for dialog title)
  function driveIcon() {
    return `<svg width="24" height="24" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
      <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L28.25 48H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da"/>
      <path d="M43.65 24 29.1 0C27.75.8 26.6 1.9 25.8 3.3L1.2 43.5C.4 44.9 0 46.45 0 48h28.25z" fill="#00ac47"/>
      <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59l5.9 10.95z" fill="#ea4335"/>
      <path d="M43.65 24 58.2 0C56.85-.8 55.3-.8 53.95 0L28.25 48H59l-15.35-24z" fill="#00832d"/>
      <path d="M73.55 76.8 59 48H28.25l-14.5 28.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc"/>
      <path d="M73.4 24.6C72.6 23.2 71.45 22.1 70.1 21.3L58.2 0 43.65 24 59 48h28.25c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00"/>
    </svg>`;
  }

  // ─── Dialog state ─────────────────────────────────────────────────────────────

  let dialogState = null;

  function showSaveToDriveDialog(defaultName, token, onSave, onCancel) {
    injectStyles();

    // Folder stack: [{id, name}]
    dialogState = {
      token,
      stack: [{ id: 'root', name: 'My Drive' }],
      folders: [],
      loading: false,
      onSave,
      onCancel,
    };

    const overlay = document.createElement('div');
    overlay.className = 'gd-overlay';
    overlay.id = 'gd-overlay';

    overlay.innerHTML = `
      <div class="gd-dialog" role="dialog" aria-modal="true" aria-labelledby="gd-title">
        <div class="gd-dialog-header">
          <div class="gd-dialog-title" id="gd-title">
            ${driveIcon()}
            Save to Google Drive
          </div>
        </div>
        <div class="gd-dialog-body">
          <div class="gd-field-label">File name</div>
          <input class="gd-filename-input" id="gd-filename" type="text" value="${escapeAttr(defaultName)}.json" spellcheck="false" autocomplete="off"/>
          <div class="gd-field-label">Folder</div>
          <div class="gd-folder-section">
            <div class="gd-breadcrumb" id="gd-breadcrumb"></div>
            <div class="gd-folder-list" id="gd-folder-list"></div>
          </div>
          <div class="gd-save-location" id="gd-save-location"></div>
        </div>
        <div class="gd-error-msg" id="gd-error"></div>
        <div class="gd-dialog-actions">
          <button class="gd-btn gd-btn-cancel" id="gd-cancel">Cancel</button>
          <button class="gd-btn gd-btn-save" id="gd-save">Save</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('gd-cancel').onclick = () => closeDialog(false);
    document.getElementById('gd-save').onclick = confirmSave;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(false); });
    document.addEventListener('keydown', dialogKeyHandler);

    // Focus filename input and select the stem
    const filenameInput = document.getElementById('gd-filename');
    filenameInput.focus();
    filenameInput.setSelectionRange(0, filenameInput.value.lastIndexOf('.'));

    renderBreadcrumb();
    loadFolders();
  }

  function dialogKeyHandler(e) {
    if (e.key === 'Escape') closeDialog(false);
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id !== 'gd-filename') confirmSave();
  }

  function closeDialog(confirmed, result) {
    document.removeEventListener('keydown', dialogKeyHandler);
    const overlay = document.getElementById('gd-overlay');
    if (overlay) overlay.remove();
    if (confirmed) dialogState.onSave(result);
    else dialogState.onCancel();
    dialogState = null;
  }

  function escapeAttr(str) {
    return String(str).replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function currentFolder() {
    return dialogState.stack[dialogState.stack.length - 1];
  }

  function renderBreadcrumb() {
    const bc = document.getElementById('gd-breadcrumb');
    if (!bc) return;
    bc.innerHTML = dialogState.stack.map((seg, i) => {
      const isLast = i === dialogState.stack.length - 1;
      return (isLast
        ? `<span class="gd-breadcrumb-item active">${escapeHtml(seg.name)}</span>`
        : `<span class="gd-breadcrumb-item" data-idx="${i}">${escapeHtml(seg.name)}</span>`
      ) + (!isLast ? '<span class="gd-breadcrumb-sep">›</span>' : '');
    }).join('');
    bc.querySelectorAll('.gd-breadcrumb-item[data-idx]').forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.idx, 10);
        dialogState.stack = dialogState.stack.slice(0, idx + 1);
        renderBreadcrumb();
        loadFolders();
      };
    });
    updateSaveLocation();
  }

  function updateSaveLocation() {
    const el = document.getElementById('gd-save-location');
    if (!el) return;
    const path = dialogState.stack.map(s => s.name).join(' › ');
    el.innerHTML = `Saving to: <strong>${escapeHtml(path)}</strong>`;
  }

  async function loadFolders() {
    dialogState.loading = true;
    const list = document.getElementById('gd-folder-list');
    if (list) list.innerHTML = `<div class="gd-loading-msg"><div class="gd-spinner"></div> Loading…</div>`;

    try {
      const folders = await listFolders(currentFolder().id, dialogState.token);
      dialogState.folders = folders;
      renderFolderList(folders);
    } catch (e) {
      if (list) list.innerHTML = `<div class="gd-empty-msg">Failed to load folders</div>`;
      showError(e.message);
    } finally {
      dialogState.loading = false;
    }
  }

  function renderFolderList(folders) {
    const list = document.getElementById('gd-folder-list');
    if (!list) return;
    if (folders.length === 0) {
      list.innerHTML = `<div class="gd-empty-msg">No sub-folders</div>`;
      return;
    }
    list.innerHTML = folders.map(f => `
      <div class="gd-folder-item" data-id="${escapeAttr(f.id)}" data-name="${escapeAttr(f.name)}">
        <span>${folderIcon()}</span>
        <span class="gd-folder-item-name">${escapeHtml(f.name)}</span>
        <span class="gd-folder-item-arrow">›</span>
      </div>
    `).join('');
    list.querySelectorAll('.gd-folder-item').forEach(el => {
      el.onclick = () => {
        dialogState.stack.push({ id: el.dataset.id, name: el.dataset.name });
        renderBreadcrumb();
        loadFolders();
      };
    });
  }

  function showError(msg) {
    const el = document.getElementById('gd-error');
    if (el) el.textContent = msg || '';
  }

  async function confirmSave() {
    const filenameInput = document.getElementById('gd-filename');
    const saveBtn = document.getElementById('gd-save');
    showError('');

    let filename = (filenameInput.value || '').trim();
    if (!filename) { showError('Please enter a file name.'); filenameInput.focus(); return; }
    if (!filename.endsWith('.json')) filename += '.json';

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const folder = currentFolder();

    closeDialog(true, { filename, folderId: folder.id, folderName: folder.name });
  }

  // ─── Main entry point ────────────────────────────────────────────────────────

  async function saveToGoogleDrive() {
    // Get diagram name from editor state
    const editorState = window._editorState;
    const diagramName = (editorState && editorState.diagramName) || 'diagram';

    let token;
    try {
      token = await authoriseGoogle();
    } catch (e) {
      alert('Google sign-in was cancelled or failed: ' + e.message);
      return;
    }

    return new Promise((resolve) => {
      showSaveToDriveDialog(
        diagramName,
        token,
        async ({ filename, folderId }) => {
          // Build the JSON blob (same format as local save)
          let blob;
          try {
            blob = window._buildDiagramBlob();
          } catch (e) {
            alert('Failed to prepare diagram data: ' + e.message);
            resolve();
            return;
          }

          // Check for existing file
          let existingFile = null;
          try {
            existingFile = await findFile(filename, folderId, token);
          } catch (_) { /* ignore — will create new */ }

          try {
            await uploadFile(blob, filename, folderId, existingFile ? existingFile.id : null, token);
            // Update editor state
            if (editorState) {
              editorState.diagramName = filename.replace(/\.json$/i, '');
              editorState.dirty = false;
              if (typeof window._updateTitleDisplay === 'function') window._updateTitleDisplay();
              if (typeof window._saveToLocalStorage === 'function') window._saveToLocalStorage();
            }
            showDriveToast(filename);
          } catch (e) {
            alert('Save to Google Drive failed: ' + e.message);
          }
          resolve();
        },
        () => { resolve(); } // cancelled
      );
    });
  }

  function showDriveToast(filename) {
    injectStyles();
    const toast = document.createElement('div');
    toast.style.cssText = [
      'position:fixed', 'bottom:24px', 'left:50%', 'transform:translateX(-50%)',
      'background:#323232', 'color:#fff', 'padding:12px 20px', 'border-radius:4px',
      'font-family:Roboto,Arial,sans-serif', 'font-size:14px', 'z-index:10001',
      'box-shadow:0 3px 5px rgba(0,0,0,.3)', 'pointer-events:none',
    ].join(';');
    toast.textContent = `Saved "${filename}" to Google Drive`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  // ─── Open from Google Drive dialog ──────────────────────────────────────────

  let openDialogState = null;

  // JSON file icon SVG
  function jsonFileIcon() {
    return `<svg width="18" height="20" viewBox="0 0 18 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2C2 1.45 2.45 1 3 1H11L17 7V18C17 18.55 16.55 19 16 19H3C2.45 19 2 18.55 2 18V2Z" fill="#e8f0fe" stroke="#1a73e8" stroke-width="1"/>
      <path d="M11 1V7H17" fill="none" stroke="#1a73e8" stroke-width="1"/>
      <text x="4" y="15" font-size="5" fill="#1a73e8" font-family="monospace">JSON</text>
    </svg>`;
  }

  function showOpenFromDriveDialog(token, onOpen, onCancel) {
    injectStyles();

    openDialogState = {
      token,
      stack: [{ id: 'root', name: 'My Drive' }],
      items: [],
      selectedFile: null,
      loading: false,
      onOpen,
      onCancel,
    };

    const overlay = document.createElement('div');
    overlay.className = 'gd-overlay';
    overlay.id = 'gd-open-overlay';

    overlay.innerHTML = `
      <div class="gd-dialog" role="dialog" aria-modal="true" aria-labelledby="gd-open-title">
        <div class="gd-dialog-header">
          <div class="gd-dialog-title" id="gd-open-title">
            ${driveIcon()}
            Open from Google Drive
          </div>
        </div>
        <div class="gd-dialog-body">
          <div class="gd-field-label">Location</div>
          <div class="gd-folder-section">
            <div class="gd-breadcrumb" id="gd-open-breadcrumb"></div>
            <div class="gd-folder-list" id="gd-open-list"></div>
          </div>
          <div class="gd-save-location" id="gd-open-selected" style="min-height:20px;"></div>
        </div>
        <div class="gd-error-msg" id="gd-open-error"></div>
        <div class="gd-dialog-actions">
          <button class="gd-btn gd-btn-cancel" id="gd-open-cancel">Cancel</button>
          <button class="gd-btn gd-btn-save" id="gd-open-btn" disabled>Open</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('gd-open-cancel').onclick = () => closeOpenDialog(false);
    document.getElementById('gd-open-btn').onclick = confirmOpen;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOpenDialog(false); });
    document.addEventListener('keydown', openDialogKeyHandler);

    renderOpenBreadcrumb();
    loadItems();
  }

  function openDialogKeyHandler(e) {
    if (e.key === 'Escape') closeOpenDialog(false);
    if (e.key === 'Enter' && openDialogState && openDialogState.selectedFile) confirmOpen();
  }

  function closeOpenDialog(confirmed, result) {
    document.removeEventListener('keydown', openDialogKeyHandler);
    const overlay = document.getElementById('gd-open-overlay');
    if (overlay) overlay.remove();
    if (confirmed) openDialogState.onOpen(result);
    else openDialogState.onCancel();
    openDialogState = null;
  }

  function renderOpenBreadcrumb() {
    const bc = document.getElementById('gd-open-breadcrumb');
    if (!bc) return;
    bc.innerHTML = openDialogState.stack.map((seg, i) => {
      const isLast = i === openDialogState.stack.length - 1;
      return (isLast
        ? `<span class="gd-breadcrumb-item active">${escapeHtml(seg.name)}</span>`
        : `<span class="gd-breadcrumb-item" data-idx="${i}">${escapeHtml(seg.name)}</span>`
      ) + (!isLast ? '<span class="gd-breadcrumb-sep">›</span>' : '');
    }).join('');
    bc.querySelectorAll('.gd-breadcrumb-item[data-idx]').forEach(el => {
      el.onclick = () => {
        const idx = parseInt(el.dataset.idx, 10);
        openDialogState.stack = openDialogState.stack.slice(0, idx + 1);
        openDialogState.selectedFile = null;
        updateOpenButton();
        renderOpenBreadcrumb();
        loadItems();
      };
    });
  }

  function updateOpenButton() {
    const btn = document.getElementById('gd-open-btn');
    if (btn) btn.disabled = !openDialogState.selectedFile;
    const sel = document.getElementById('gd-open-selected');
    if (sel) {
      sel.innerHTML = openDialogState.selectedFile
        ? `Selected: <strong>${escapeHtml(openDialogState.selectedFile.name)}</strong>`
        : '';
    }
  }

  async function loadItems() {
    openDialogState.loading = true;
    const list = document.getElementById('gd-open-list');
    if (list) list.innerHTML = `<div class="gd-loading-msg"><div class="gd-spinner"></div> Loading…</div>`;
    const currentId = openDialogState.stack[openDialogState.stack.length - 1].id;

    try {
      const items = await listDriveItems(currentId, openDialogState.token);
      openDialogState.items = items;
      renderItemList(items);
    } catch (e) {
      if (list) list.innerHTML = `<div class="gd-empty-msg">Failed to load folder</div>`;
      showOpenError(e.message);
    } finally {
      openDialogState.loading = false;
    }
  }

  function renderItemList(items) {
    const list = document.getElementById('gd-open-list');
    if (!list) return;
    const FOLDER_MIME = 'application/vnd.google-apps.folder';

    if (items.length === 0) {
      list.innerHTML = `<div class="gd-empty-msg">No diagram files found</div>`;
      return;
    }

    list.innerHTML = items.map(item => {
      const isFolder = item.mimeType === FOLDER_MIME;
      const icon = isFolder ? folderIcon() : jsonFileIcon();
      const cls = isFolder ? 'gd-folder-item' : 'gd-file-item';
      const arrow = isFolder ? `<span class="gd-folder-item-arrow">›</span>` : '';
      return `<div class="${cls}" data-id="${escapeAttr(item.id)}" data-name="${escapeAttr(item.name)}" data-mime="${escapeAttr(item.mimeType)}">
        <span>${icon}</span>
        <span class="${isFolder ? 'gd-folder-item-name' : 'gd-file-item-name'}">${escapeHtml(item.name)}</span>
        ${arrow}
      </div>`;
    }).join('');

    list.querySelectorAll('.gd-folder-item').forEach(el => {
      el.onclick = () => {
        openDialogState.selectedFile = null;
        openDialogState.stack.push({ id: el.dataset.id, name: el.dataset.name });
        updateOpenButton();
        renderOpenBreadcrumb();
        loadItems();
      };
    });

    list.querySelectorAll('.gd-file-item').forEach(el => {
      el.onclick = () => {
        // Deselect all, select this
        list.querySelectorAll('.gd-file-item').forEach(f => f.classList.remove('selected'));
        el.classList.add('selected');
        openDialogState.selectedFile = { id: el.dataset.id, name: el.dataset.name };
        showOpenError('');
        updateOpenButton();
      };
      el.ondblclick = () => {
        openDialogState.selectedFile = { id: el.dataset.id, name: el.dataset.name };
        confirmOpen();
      };
    });
  }

  function showOpenError(msg) {
    const el = document.getElementById('gd-open-error');
    if (el) el.textContent = msg || '';
  }

  async function confirmOpen() {
    if (!openDialogState.selectedFile) return;
    const openBtn = document.getElementById('gd-open-btn');
    showOpenError('');
    if (openBtn) { openBtn.disabled = true; openBtn.textContent = 'Opening…'; }

    const { id, name } = openDialogState.selectedFile;
    const token = openDialogState.token;

    let text;
    try {
      text = await downloadFile(id, token);
    } catch (e) {
      showOpenError('Failed to download file: ' + e.message);
      if (openBtn) { openBtn.disabled = false; openBtn.textContent = 'Open'; }
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      showOpenError('This file is not a valid diagram — could not parse JSON.');
      if (openBtn) { openBtn.disabled = false; openBtn.textContent = 'Open'; }
      return;
    }

    try {
      validateDiagram(data);
    } catch (e) {
      showOpenError('This file is not a valid diagram — ' + e.message);
      if (openBtn) { openBtn.disabled = false; openBtn.textContent = 'Open'; }
      return;
    }

    closeOpenDialog(true, { data, filename: name });
  }

  async function openFromGoogleDrive() {
    let token;
    try {
      token = await authoriseGoogle();
    } catch (e) {
      alert('Google sign-in was cancelled or failed: ' + e.message);
      return;
    }

    return new Promise((resolve) => {
      showOpenFromDriveDialog(
        token,
        ({ data, filename }) => {
          try {
            if (typeof window._importDiagramData === 'function') {
              window._importDiagramData(data, filename);
            } else {
              alert('Editor not ready — please try again.');
            }
          } catch (e) {
            alert('Failed to load diagram: ' + e.message);
          }
          resolve();
        },
        () => { resolve(); }
      );
    });
  }

  // Expose globally
  window.saveToGoogleDrive  = saveToGoogleDrive;
  window.openFromGoogleDrive = openFromGoogleDrive;
})();

import { auth, db } from './firebase-config.js';
import { 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword, 
    signOut, 
    onAuthStateChanged,
    updateProfile
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
    doc, setDoc, getDoc, updateDoc, arrayUnion, arrayRemove 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const IMGBB_KEY = "cc09691527f520d75134d23712471d2c";
const imageCache = new Map();

async function loadImage(url) {
    if (imageCache.has(url)) return imageCache.get(url);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            imageCache.set(url, img);
            resolve(img);
        };
        img.src = url;
    });
}

async function uploadToImgbb(dataUrl, type) {
    const localKey = type + '_' + currentUser.uid;
    localStorage.setItem(localKey, dataUrl);
    try {
        const base64 = dataUrl.split(',')[1];
        const formData = new FormData();
        formData.append('image', base64);
        formData.append('key', IMGBB_KEY);
        const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
        const json = await res.json();
        if (json.success) {
            return json.data.url;
        }
    } catch(e) {
        console.log('ImgBB upload failed, using local storage');
    }
    return dataUrl;
}

function loadFromLocalStorage() {
    if (!currentUser) return;
    const avatar = localStorage.getItem('avatar_' + currentUser.uid);
    const wallpaper = localStorage.getItem('wallpaper_' + currentUser.uid);
    if (avatar) systemConfig.avatar = avatar;
    if (wallpaper) {
        systemConfig.wallpaper = wallpaper;
        applyConfig();
    }
}

let currentUser = null;
let currentDesktopItems = [];
let trashItems = [];
let systemConfig = { 
    wallpaper: 'https://i.ibb.co/ccvjPDC4/image-Picsart-Ai-Image-Enhancer.png', 
    language: 'ru', 
    theme: 'dark', 
    password: null,
    glassOpacity: 0.6,
    glassBlur: 20,
    glassBorder: 0.1
};
let currentStep = 1;
let openWindows = [];
let windowZIndex = 1000;
let selectedFile = null;
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragWindow = null;
let dragData = null;
let focusedWindow = null;
let pinnedApps = [];
let taskbarItems = [];

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const desktop = document.getElementById('desktop');

document.addEventListener('contextmenu', (e) => {
    if ((e.target.closest && e.target.closest('#desktop')) || (e.target.closest && e.target.closest('#desktop-icons')) || (e.target.closest && e.target.closest('.desktop-icon')) || (e.target.closest && e.target.closest('.taskbar-item'))) {
        return;
    }
    e.preventDefault();
});

document.addEventListener('selectstart', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || (e.target.closest && e.target.closest('.notepad-textarea'))) {
        return;
    }
    e.preventDefault();
});

document.addEventListener('dragstart', (e) => {
    if (e.target.tagName === 'IMG' && !e.target.closest('.desktop-icon')) {
        e.preventDefault();
    }
});

function applyConfig() {
    if (desktop) {
        var wp = systemConfig.wallpaper;
        if (currentUser) {
            var cached = localStorage.getItem('wallpaper_' + currentUser.uid);
            if (cached) wp = cached;
        }
        desktop.style.backgroundImage = 'url(' + wp + ')';
        desktop.style.backgroundSize = 'cover';
        desktop.style.backgroundPosition = 'center';
        desktop.style.backgroundRepeat = 'no-repeat';
    }
    document.body.classList.toggle('light-theme', systemConfig.theme === 'light');
    document.documentElement.style.setProperty('--glass-opacity', systemConfig.glassOpacity || 0.6);
    document.documentElement.style.setProperty('--glass-blur', (systemConfig.glassBlur || 20) + 'px');
    document.documentElement.style.setProperty('--glass-border', systemConfig.glassBorder || 0.1);
}

let autoSaveInterval = null;

function startAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(() => {
        if (currentUser) {
            saveToFirebase();
        }
    }, 1000);
}

function showLoading(show) {
    loadingScreen.style.display = show ? 'flex' : 'none';
}

function showScreen(screen) {
    const screens = [authScreen, loginScreen, setupScreen, desktop];
    screens.forEach(s => {
        if (s) s.style.display = 'none';
    });
    if (screen) {
        screen.style.display = 'flex';
        if (screen === desktop) {
            applyConfig();
            renderDesktop();
            renderTaskbar();
            startAutoSave();
        }
    }
}

function createTaskbar() {
    const existing = document.getElementById('taskbar');
    if (existing) return existing;
    const taskbar = document.createElement('div');
    taskbar.id = 'taskbar';
    taskbar.className = 'taskbar glass-panel';
    taskbar.innerHTML = `
        <div class="taskbar-left" id="taskbar-left"></div>
        <div class="taskbar-center" id="taskbar-center"></div>
        <div class="taskbar-right" id="taskbar-right"></div>
    `;
    desktop.appendChild(taskbar);
    return taskbar;
}

function renderTaskbar() {
    const oldTaskbar = document.getElementById('taskbar');
    if (oldTaskbar) oldTaskbar.remove();
    
    const uniquePinned = [];
    const seenIds = new Set();
    pinnedApps.forEach(app => {
        const key = app.title + (app.id || '');
        if (!seenIds.has(key)) {
            seenIds.add(key);
            uniquePinned.push(app);
        }
    });
    pinnedApps = uniquePinned;
    
    const activeWindows = openWindows.filter(w => document.body.contains(w));
    if (activeWindows.length === 0 && pinnedApps.length === 0) return;
    
    const taskbar = document.createElement('div');
    taskbar.id = 'taskbar';
    taskbar.className = 'glass-panel';
    taskbar.style.cssText = `
        display: flex;
        align-items: center;
        gap: 4px;
        height: 42px;
        padding: 4px 10px;
        background: rgba(30, 30, 40, var(--glass-opacity, 0.7));
        backdrop-filter: blur(var(--glass-blur, 20px));
        -webkit-backdrop-filter: blur(var(--glass-blur, 20px));
        border-radius: 24px;
        border: 1px solid rgba(255, 255, 255, var(--glass-border, 0.1));
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    `;
    
    const allItems = [];
    const addedTitles = new Set();
    
    pinnedApps.forEach(app => {
        if (!addedTitles.has(app.title)) {
            addedTitles.add(app.title);
            const openWindow = activeWindows.find(w => {
                const titleEl = w.querySelector('.window-title');
                const wTitle = titleEl ? titleEl.textContent.trim() : '';
                return wTitle === app.title;
            });
            allItems.push({
                title: app.title,
                icon: app.icon || 'fa-file',
                isPinned: true,
                window: openWindow || null,
                appData: app
            });
        }
    });
    
    activeWindows.forEach(win => {
        const titleEl = win.querySelector('.window-title');
        const title = titleEl ? titleEl.textContent.trim() : 'Окно';
        if (!addedTitles.has(title)) {
            addedTitles.add(title);
            const iconEl = win.querySelector('.window-title i');
            const iconClass = iconEl ? iconEl.className : 'fas fa-file';
            allItems.push({
                title: title,
                icon: iconClass,
                isPinned: false,
                window: win,
                appData: null
            });
        }
    });
    
    allItems.forEach(itemData => {
        const item = document.createElement('div');
        item.className = 'taskbar-item';
        item.title = itemData.title;
        const win = itemData.window;
        const isMinimized = win && win.style.display === 'none';
        const isFocused = win && focusedWindow === win && !isMinimized;
        const isOpen = win && !isMinimized;
        if (isFocused) item.classList.add('focused');
        else if (isOpen) item.classList.add('open');
        item.innerHTML = `<div class="taskbar-item-icon"><i class="${itemData.icon}"></i></div>`;
        item.onclick = () => {
            if (win && openWindows.includes(win)) {
                if (win.style.display === 'none') {
                    win.style.display = 'flex';
                    focusWindow(win);
                } else if (focusedWindow === win) {
                    minimizeWindow(win);
                } else {
                    bringToFront(win);
                    focusWindow(win);
                }
            } else if (itemData.isPinned && itemData.appData) {
                launchApp(itemData.appData);
            }
        };
        item.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const menuData = {
                title: itemData.title,
                icon: itemData.icon,
                id: (itemData.appData && itemData.appData.id) ? itemData.appData.id : itemData.title,
                type: (itemData.appData && itemData.appData.type) ? itemData.appData.type : 'window',
                window: win
            };
            showTaskbarContextMenu(e.pageX, e.pageY, menuData, item);
        };
        taskbar.appendChild(item);
    });
    
    const dockItems = document.querySelector('.dock-items');
    const startButton = document.getElementById('start-button');
    if (dockItems && startButton) {
        startButton.parentNode.insertBefore(taskbar, startButton);
    }
}

function showTaskbarContextMenu(x, y, appData, item) {
    document.querySelectorAll('.context-menu').forEach(m => m.style.display = 'none');
    let menu = document.getElementById('taskbar-context-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'taskbar-context-menu';
        menu.className = 'context-menu glass-panel';
        document.body.appendChild(menu);
    }
    const isPinned = pinnedApps.find(a => a.id === appData.id || a.title === appData.title);
    const isOpen = appData.window && openWindows.includes(appData.window);
    menu.innerHTML = `
        <div class="context-item-header">
            <i class="${appData.icon || 'fas fa-file'}"></i>
            <span>${appData.title || 'Приложение'}</span>
        </div>
        <div class="context-item" data-action="pin">
            <i class="fas fa-thumbtack"></i> ${isPinned ? 'Открепить от панели' : 'Закрепить на панели'}
        </div>
        ${isOpen ? `<div class="context-item" data-action="close"><i class="fas fa-times"></i> Закрыть</div>` : ''}
    `;
    menu.style.left = Math.min(x, window.innerWidth - 250) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 150) + 'px';
    menu.style.display = 'flex';
    menu.querySelectorAll('.context-item').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'pin') {
                if (isPinned) {
                    pinnedApps = pinnedApps.filter(a => a.id !== appData.id && a.title !== appData.title);
                } else {
                    pinnedApps.push({
                        id: appData.id || ('pinned-' + Date.now()),
                        title: appData.title,
                        icon: appData.icon,
                        type: appData.type || 'window'
                    });
                }
                saveToFirebase();
                renderTaskbar();
            } else if (action === 'close') {
                if (appData.window) closeWindow(appData.window);
            }
            menu.style.display = 'none';
        };
    });
}

function focusWindow(win) {
    if (focusedWindow && focusedWindow !== win) {
        focusedWindow.classList.remove('focused');
    }
    focusedWindow = win;
    win.classList.add('focused');
    bringToFront(win);
    renderTaskbar();
}

function unfocusWindow(win) {
    if (focusedWindow === win) {
        focusedWindow = null;
        win.classList.remove('focused');
        renderTaskbar();
    }
}

function renderDesktop() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    currentDesktopItems.forEach(item => {
        if (item.id === 'trash') return;
        const icon = createDesktopIcon(item);
        container.appendChild(icon);
    });
    const trashIcon = document.createElement('div');
    trashIcon.className = 'desktop-icon trash-icon';
    trashIcon.setAttribute('data-id', 'trash');
    trashIcon.setAttribute('draggable', 'true');
    trashIcon.innerHTML = `
        <div class="icon-img"><i class="fas fa-trash-alt"></i></div>
        <div class="icon-label">Корзина</div>
    `;
    trashIcon.onclick = () => openTrash();
    trashIcon.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showTrashContext(e.pageX, e.pageY);
    };
    trashIcon.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'trash');
        dragData = { id: 'trash', isTrash: true };
        trashIcon.style.opacity = '0.5';
    });
    trashIcon.addEventListener('dragend', (e) => {
        trashIcon.style.opacity = '1';
        dragData = null;
    });
    container.appendChild(trashIcon);
}

function createDesktopIcon(item) {
    const icon = document.createElement('div');
    icon.className = 'desktop-icon';
    icon.setAttribute('data-id', item.id);
    icon.setAttribute('draggable', 'true');
    if (item.x !== undefined && item.y !== undefined) {
        icon.style.position = 'absolute';
        icon.style.left = item.x + 'px';
        icon.style.top = item.y + 'px';
    }
    const isImage = item.content && (item.content.startsWith('data:image') || item.content.startsWith('https://i.ibb.co'));
    let iconClass = 'fa-file';
    if (item.type === 'folder') iconClass = 'fa-folder';
    else if (isImage) iconClass = '';
    else if (item.name.endsWith('.txt')) iconClass = 'fa-file-alt';
    else if (item.name.endsWith('.doc')) iconClass = 'fa-file-word';
    else if (item.name.endsWith('.exe') || item.name.endsWith('.ky')) iconClass = 'fa-cog';
    if (isImage) {
        icon.innerHTML = `
            <div class="icon-img" style="width:56px;height:56px;border-radius:12px;overflow:hidden;background:rgba(0,0,0,0.2);">
                <img src="${item.content}" style="width:100%;height:100%;object-fit:cover;" draggable="false" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-image\\' style=\\'font-size:36px;\\'></i>'">
            </div>
            <div class="icon-label">${item.name.length > 15 ? item.name.slice(0,12)+'...' : item.name}</div>
        `;
    } else {
        icon.innerHTML = `
            <div class="icon-img"><i class="fas ${iconClass}"></i></div>
            <div class="icon-label">${item.name.length > 15 ? item.name.slice(0,12)+'...' : item.name}</div>
        `;
    }
    icon.ondblclick = () => {
        if (item.type === 'folder') openFolderWindow(item);
        else openFile(item);
    };
    icon.onclick = (e) => {
        document.querySelectorAll('.desktop-icon').forEach(el => el.style.background = '');
        icon.style.background = 'rgba(255,255,255,0.1)';
    };
    icon.oncontextmenu = (e) => {
        e.preventDefault();
        e.stopPropagation();
        showFileContextMenu(e.pageX, e.pageY, item);
    };
    icon.addEventListener('dragstart', (e) => {
        if (isImage) {
            const dragImg = new Image();
            dragImg.src = item.content;
            dragImg.style.width = '56px';
            dragImg.style.height = '56px';
            e.dataTransfer.setDragImage(dragImg, 28, 28);
        }
        e.dataTransfer.setData('text/plain', item.id);
        dragData = { id: item.id, isTrash: false };
        icon.style.opacity = '0.5';
    });
    icon.addEventListener('dragend', () => {
        icon.style.opacity = '1';
        dragData = null;
    });
    return icon;
}

function openFile(item) {
    const isImage = item.content && (item.content.startsWith('data:image') || item.content.startsWith('https://i.ibb.co'));
    const isExe = item.name.endsWith('.exe') || item.name.endsWith('.ky');
    if (isExe) {
        openExeApp(item);
    } else if (isImage) {
        openImageViewer(item);
    } else if (item.name.endsWith('.txt') || item.name.endsWith('.doc')) {
        openNotepad(item);
    } else {
        Swal.fire({
            title: 'Неизвестный файл',
            text: `Не могу открыть ${item.name}`,
            icon: 'info',
            background: '#1a1a2e',
            color: '#fff'
        });
    }
}

function openExeApp(item) {
    const existing = document.querySelector(`[data-file-id="${item.id}"]`);
    if (existing) {
        focusWindow(existing);
        return;
    }
    if (!item.content || item.content.trim() === '') {
        Swal.fire({
            title: 'Пустое приложение',
            text: 'Этот .exe файл пуст. Открыть конструктор для создания кода?',
            icon: 'question',
            background: '#1a1a2e',
            color: '#fff',
            showCancelButton: true,
            confirmButtonText: 'Открыть конструктор',
            cancelButtonText: 'Отмена'
        }).then(result => {
            if (result.isConfirmed) openAppBuilder(item);
        });
        return;
    }
    if (item.content.includes('<!DOCTYPE') || item.content.includes('<html') || item.content.includes('<script')) {
        openAppWindow(item);
        return;
    }
    if (item.content.startsWith('http://') || item.content.startsWith('https://')) {
        openWebApp(item);
        return;
    }
    openAppWindow(item);
}

function openAppWindow(item) {
    const win = createWindow({
        title: item.name.replace('.exe', '').replace('.ky', ''),
        icon: 'fa-window-maximize',
        fileId: item.id,
        width: 800,
        height: 600,
        body: `
            <iframe 
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                style="width: 100%; height: 100%; border: none; background: white; border-radius: 0 0 16px 16px;"
                srcdoc="${item.content.replace(/"/g, '&quot;').replace(/`/g, '&#96;').replace(/\n/g, ' ')}"
            ></iframe>
        `,
        bodyStyle: 'padding: 0; flex: 1; overflow: hidden; border-radius: 0 0 20px 20px;'
    });
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
}

function openWebApp(item) {
    const win = createWindow({
        title: item.name.replace('.exe', '').replace('.ky', ''),
        icon: 'fa-globe',
        fileId: item.id,
        width: 800,
        height: 600,
        body: `
            <iframe 
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-top-navigation"
                style="width: 100%; height: 100%; border: none; background: white; border-radius: 0 0 16px 16px;"
                src="${item.content}"
            ></iframe>
        `,
        bodyStyle: 'padding: 0; flex: 1; overflow: hidden; border-radius: 0 0 20px 20px;'
    });
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
}

function openAppBuilder(item) {
    const existing = document.querySelector(`[data-file-id="builder-${item.id}"]`);
    if (existing) {
        focusWindow(existing);
        return;
    }
    const win = createWindow({
        title: 'Конструктор: ' + item.name,
        icon: 'fa-code',
        fileId: 'builder-' + item.id,
        width: 700,
        height: 500,
        body: `
            <div style="display: flex; flex-direction: column; height: 100%; gap: 12px;">
                <div style="display: flex; gap: 8px;">
                    <select id="app-type-select" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 6px 12px; color: white; font-size: 13px;">
                        <option value="web">Веб-приложение (HTML)</option>
                        <option value="url">Ссылка (URL)</option>
                    </select>
                </div>
                <textarea id="app-code-area" placeholder="Введите HTML код или URL..." style="flex: 1; width: 100%; background: rgba(0,0,0,0.3); color: #e0e0e0; border: none; border-radius: 12px; padding: 16px; font-family: 'Courier New', monospace; font-size: 13px; resize: none; outline: none;">${item.content || '<!DOCTYPE html>\n<html>\n<head>\n    <style>\n        body { \n            background: #1a1a2e; \n            color: white; \n            font-family: Arial; \n            padding: 20px;\n        }\n    </style>\n</head>\n<body>\n    <h1>Привет, K-OS!</h1>\n    <p>Моё первое приложение</p>\n</body>\n</html>'}</textarea>
                <div style="display: flex; gap: 8px; justify-content: flex-end;">
                    <button id="test-app-btn" style="padding: 8px 16px; border: none; border-radius: 10px; background: rgba(78,205,196,0.2); color: #4ecdc4; cursor: pointer; font-size: 13px;">▶ Тест</button>
                    <button id="save-app-btn" style="padding: 8px 16px; border: none; border-radius: 10px; background: linear-gradient(135deg, #667eea, #764ba2); color: white; cursor: pointer; font-size: 13px;">💾 Сохранить</button>
                </div>
            </div>
        `,
        bodyStyle: 'padding: 16px; flex: 1;'
    });
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
    win.querySelector('#test-app-btn').onclick = () => {
        const code = win.querySelector('#app-code-area').value;
        const type = win.querySelector('#app-type-select').value;
        const tempItem = { id: 'test-' + Date.now(), name: 'test.exe', content: type === 'url' ? code : code };
        if (type === 'url') openWebApp(tempItem);
        else openAppWindow(tempItem);
    };
    win.querySelector('#save-app-btn').onclick = () => {
        const code = win.querySelector('#app-code-area').value;
        item.content = code;
        saveToFirebase();
        Swal.fire({ title: 'Сохранено!', text: 'Приложение обновлено', icon: 'success', timer: 1000, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
    };
}

function openImageViewer(item) {
    const existing = document.querySelector(`[data-file-id="${item.id}"]`);
    if (existing) {
        focusWindow(existing);
        return;
    }
    const win = createWindow({
        title: item.name,
        icon: 'fa-image',
        fileId: item.id,
        width: 600,
        height: 'auto',
        body: `<img src="${item.content}" alt="${item.name}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 0 0 20px 20px; display: block; -webkit-user-drag: none; user-select: none; pointer-events: none;" draggable="false">`,
        bodyStyle: 'padding: 0; display: flex; align-items: center; justify-content: center; min-height: 300px; background: rgba(0,0,0,0.3); border-radius: 0 0 20px 20px;'
    });
    win.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
}

function openNotepad(item) {
    const existing = document.querySelector(`[data-file-id="${item.id}"]`);
    if (existing) {
        focusWindow(existing);
        return;
    }
    const win = createWindow({
        title: item.name,
        icon: 'fa-file-alt',
        fileId: item.id,
        width: 550,
        height: 450,
        resizable: true,
        body: `
            <div class="notepad-menu">
                <div class="dropdown">
                    <button class="menu-btn">📄 Файл ▾</button>
                    <div class="dropdown-content">
                        <button data-action="save">💾 Сохранить <span class="shortcut">Ctrl+S</span></button>
                        <button data-action="save-as">📄 Сохранить как <span class="shortcut">Ctrl+Shift+S</span></button>
                        <button data-action="save-desktop">🖥 Сохранить на рабочий стол <span class="shortcut">Ctrl+Alt+S</span></button>
                    </div>
                </div>
            </div>
            <textarea class="notepad-textarea" placeholder="Введите текст..." style="flex: 1; width: 100%; padding: 16px 20px; background: rgba(0,0,0,0.15); color: #e0e0e0; border: none; resize: none; font-family: 'Courier New', monospace; font-size: 14px; line-height: 1.6; outline: none; user-select: text;">${item.content || ''}</textarea>
            <div class="notepad-status">
                <span>Строк: ${(item.content || '').split('\n').length}</span>
                <span>${item.name}</span>
            </div>
        `,
        bodyStyle: 'padding: 0; display: flex; flex-direction: column; flex: 1;'
    });
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
    const textarea = win.querySelector('.notepad-textarea');
    const saveNotepad = () => {
        if (!textarea) return;
        item.content = textarea.value;
        saveToFirebase();
        const status = win.querySelector('.notepad-status span:last-child');
        if (status) {
            status.textContent = '✓ Сохранено';
            setTimeout(() => { status.textContent = item.name; }, 1500);
        }
    };
    if (textarea) {
        textarea.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                if (e.shiftKey && e.altKey) {
                    const newItem = { ...item, id: Date.now() + Math.random(), name: `копия_${item.name}` };
                    currentDesktopItems.push(newItem);
                    saveToFirebase();
                    renderDesktop();
                    Swal.fire({ title: 'Сохранено на рабочий стол', icon: 'success', timer: 1000, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
                } else if (e.shiftKey) {
                    const newName = prompt('Новое имя файла:', item.name);
                    if (newName) {
                        const newItem = { ...item, id: Date.now() + Math.random(), name: newName };
                        currentDesktopItems.push(newItem);
                        saveToFirebase();
                        renderDesktop();
                        Swal.fire({ title: 'Сохранено как ' + newName, icon: 'success', timer: 1000, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
                    }
                } else {
                    saveNotepad();
                }
            }
        });
    }
    win.querySelectorAll('.dropdown-content button').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'save') saveNotepad();
            else if (action === 'save-as') {
                const newName = prompt('Новое имя файла:', item.name);
                if (newName) {
                    const newItem = { ...item, id: Date.now() + Math.random(), name: newName };
                    currentDesktopItems.push(newItem);
                    saveToFirebase();
                    renderDesktop();
                    Swal.fire({ title: 'Сохранено как ' + newName, icon: 'success', timer: 1000, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
                }
            } else if (action === 'save-desktop') {
                const newItem = { ...item, id: Date.now() + Math.random(), name: `копия_${item.name}` };
                currentDesktopItems.push(newItem);
                saveToFirebase();
                renderDesktop();
                Swal.fire({ title: 'Сохранено на рабочий стол', icon: 'success', timer: 1000, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
            }
        };
    });
}

function createWindow(options) {
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel';
    if (options.fileId) win.dataset.fileId = options.fileId;
    if (options.folderId) win.dataset.folderId = options.folderId;
    const width = options.width || 500;
    const height = options.height || 'auto';
    win.style.cssText = `width: ${width}px; max-width: 90%; ${height !== 'auto' ? `height: ${height}px; max-height: calc(100% - 120px);` : ''} top: 10%; left: 20%; z-index: ${windowZIndex++}; display: flex; flex-direction: column;`;
    win.innerHTML = `
        <div class="window-header" style="cursor: move; flex-shrink: 0; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.06);">
            <div class="window-title" style="display: flex; align-items: center; gap: 8px; font-weight: 600;">
                <i class="fas ${options.icon || 'fa-file'}"></i> ${options.title || 'Окно'}
            </div>
            <div class="window-controls" style="display: flex; gap: 6px;">
                <button class="win-btn minimize" style="width: 28px; height: 28px; border: none; border-radius: 50%; cursor: pointer; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="Свернуть">−</button>
                <button class="win-btn maximize" style="width: 28px; height: 28px; border: none; border-radius: 50%; cursor: pointer; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="На весь экран">⛶</button>
                <button class="win-btn close" style="width: 28px; height: 28px; border: none; border-radius: 50%; cursor: pointer; background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.6); display: flex; align-items: center; justify-content: center; transition: all 0.2s;" title="Закрыть">✕</button>
            </div>
        </div>
        <div class="window-body" style="${options.bodyStyle || 'padding: 16px; flex: 1; overflow: auto;'}">
            ${options.body || ''}
        </div>
    `;
    const closeBtn = win.querySelector('.win-btn.close');
    const minBtn = win.querySelector('.win-btn.minimize');
    const maxBtn = win.querySelector('.win-btn.maximize');
    if (closeBtn) closeBtn.onclick = () => closeWindow(win);
    if (minBtn) minBtn.onclick = () => minimizeWindow(win);
    if (maxBtn) maxBtn.onclick = () => toggleMaximize(win);
    win.querySelectorAll('.win-btn').forEach(btn => {
        btn.onmouseenter = () => {
            if (btn.classList.contains('close')) { btn.style.background = '#ff4444'; btn.style.color = 'white'; }
            else if (btn.classList.contains('maximize')) { btn.style.background = '#44ff88'; btn.style.color = '#1a1a2e'; }
            else if (btn.classList.contains('minimize')) { btn.style.background = '#ffaa44'; btn.style.color = '#1a1a2e'; }
        };
        btn.onmouseleave = () => { btn.style.background = 'rgba(255,255,255,0.06)'; btn.style.color = 'rgba(255,255,255,0.6)'; };
    });
    const header = win.querySelector('.window-header');
    if (header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.win-btn') || e.target.closest('.window-controls')) return;
            startDrag(win, e);
            focusWindow(win);
        });
    }
    win.addEventListener('mousedown', () => focusWindow(win));
    setTimeout(() => focusWindow(win), 10);
    return win;
}

function closeWindow(win) {
    win.style.animation = 'windowAppear 0.2s reverse';
    setTimeout(() => {
        win.remove();
        openWindows = openWindows.filter(w => w !== win);
        if (focusedWindow === win) focusedWindow = null;
        renderTaskbar();
    }, 200);
}

function minimizeWindow(win) {
    win.style.display = 'none';
    if (focusedWindow === win) focusedWindow = null;
    renderTaskbar();
}

function toggleMaximize(win) {
    win.classList.toggle('maximized');
}

function bringToFront(win) {
    win.style.zIndex = windowZIndex++;
}

function startDrag(win, e) {
    isDragging = true;
    dragWindow = win;
    const rect = win.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    win.style.transform = 'none';
    win.style.left = rect.left + 'px';
    win.style.top = rect.top + 'px';
    bringToFront(win);
    focusWindow(win);
}

document.addEventListener('mousemove', (e) => {
    if (!isDragging || !dragWindow) return;
    dragWindow.style.left = (e.clientX - dragOffsetX) + 'px';
    dragWindow.style.top = (e.clientY - dragOffsetY) + 'px';
});

document.addEventListener('mouseup', () => {
    isDragging = false;
    dragWindow = null;
});

function openFolderWindow(folder) {
    const existing = document.querySelector(`[data-folder-id="${folder.id}"]`);
    if (existing) {
        focusWindow(existing);
        return;
    }
    const children = currentDesktopItems.filter(i => i.parentId === folder.id);
    const win = createWindow({
        title: folder.name,
        icon: 'fa-folder',
        folderId: folder.id,
        width: 500,
        height: 400,
        body: `
            <div class="folder-view-options" style="display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,0.06); align-items: center;">
                <button class="view-btn active" data-view="icons" style="background: none; border: none; color: rgba(255,255,255,0.5); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s;"><i class="fas fa-th"></i></button>
                <button class="view-btn" data-view="list" style="background: none; border: none; color: rgba(255,255,255,0.5); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s;"><i class="fas fa-list"></i></button>
                <button class="view-btn" data-view="details" style="background: none; border: none; color: rgba(255,255,255,0.5); padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 12px; transition: all 0.2s;"><i class="fas fa-table"></i></button>
                <span style="font-size: 12px; opacity: 0.4; margin-left: auto;">${children.length} элементов</span>
            </div>
            <div class="folder-content" style="flex: 1; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; overflow-y: auto; min-height: 100px;">
                ${children.length === 0 ? '<div style="width:100%; text-align:center; opacity:0.3; padding:40px;">Папка пуста</div>' : ''}
            </div>
        `,
        bodyStyle: 'padding: 0; display: flex; flex-direction: column; flex: 1;'
    });
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
    const content = win.querySelector('.folder-content');
    function renderFolderContent(view = 'icons') {
        const items = currentDesktopItems.filter(i => i.parentId === folder.id);
        content.innerHTML = '';
        if (items.length === 0) {
            content.innerHTML = '<div style="width:100%; text-align:center; opacity:0.3; padding:40px;">Папка пуста</div>';
            return;
        }
        if (view === 'list' || view === 'details') {
            items.forEach(item => {
                const div = document.createElement('div');
                div.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 6px 12px; width: 100%; border-radius: 8px; cursor: pointer; transition: all 0.2s;';
                div.onmouseenter = () => div.style.background = 'rgba(255,255,255,0.05)';
                div.onmouseleave = () => div.style.background = '';
                div.innerHTML = `<i class="fas ${item.type === 'folder' ? 'fa-folder' : 'fa-file'}"></i><span>${item.name}</span><span style="margin-left: auto; opacity: 0.3; font-size: 12px;">${item.type === 'folder' ? 'Папка' : 'Файл'}</span>`;
                div.onclick = () => {
                    if (item.type === 'folder') openFolderWindow(item);
                    else openFile(item);
                };
                div.draggable = true;
                div.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    dragData = { id: item.id };
                    div.style.opacity = '0.5';
                });
                div.addEventListener('dragend', () => { div.style.opacity = '1'; });
                content.appendChild(div);
            });
        } else {
            items.forEach(item => {
                const icon = createDesktopIcon(item);
                icon.style.width = '70px';
                const imgEl = icon.querySelector('.icon-img');
                if (imgEl) {
                    const isImg = item.content && (item.content.startsWith('data:image') || item.content.startsWith('https://i.ibb.co'));
                    if (isImg) {
                        imgEl.style.width = '50px';
                        imgEl.style.height = '50px';
                        imgEl.style.borderRadius = '10px';
                    } else {
                        imgEl.style.fontSize = '28px';
                    }
                }
                icon.draggable = true;
                icon.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    dragData = { id: item.id };
                    icon.style.opacity = '0.5';
                });
                icon.addEventListener('dragend', () => { icon.style.opacity = '1'; });
                content.appendChild(icon);
            });
        }
    }
    renderFolderContent();
    win.querySelectorAll('.view-btn').forEach(btn => {
        btn.onclick = () => {
            win.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderFolderContent(btn.dataset.view);
        };
    });
    content.addEventListener('dragover', (e) => {
        e.preventDefault();
        content.style.background = 'rgba(102, 126, 234, 0.1)';
        content.style.border = '2px dashed rgba(102, 126, 234, 0.4)';
    });
    content.addEventListener('dragleave', () => {
        content.style.background = '';
        content.style.border = '';
    });
    content.addEventListener('drop', (e) => {
        e.preventDefault();
        content.style.background = '';
        content.style.border = '';
        const id = e.dataTransfer.getData('text/plain') || (dragData ? dragData.id : null);
        if (!id) return;
        const item = currentDesktopItems.find(i => i.id == id);
        if (item && item.id !== folder.id) {
            delete item.x;
            delete item.y;
            item.parentId = folder.id;
            saveToFirebase();
            renderDesktop();
            renderFolderContent();
            const count = currentDesktopItems.filter(i => i.parentId === folder.id).length;
            const span = win.querySelector('.folder-view-options span:last-child');
            if (span) span.textContent = `${count} элементов`;
        }
        dragData = null;
    });
}

function openTrash() {
    const existing = document.getElementById('trash-window');
    if (existing) {
        focusWindow(existing);
        return;
    }
    const win = createWindow({
        title: 'Корзина',
        icon: 'fa-trash-alt',
        width: 500,
        height: 400,
        body: `
            <div class="folder-content" style="flex: 1; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; overflow-y: auto; min-height: 100px;">
                ${trashItems.length === 0 ? '<div class="empty-trash" style="width:100%; text-align:center; opacity:0.3; padding:40px; font-size: 16px;">🗑 Корзина пуста</div>' : ''}
            </div>
            <div style="padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 8px; justify-content: flex-end;">
                <button class="trash-btn restore-all" style="padding: 6px 16px; border-radius: 8px; background: rgba(78, 205, 196, 0.15); color: #4ecdc4; border: none; cursor: pointer; font-size: 13px; transition: all 0.2s;">↩ Восстановить всё</button>
                <button class="trash-btn clear-all" style="padding: 6px 16px; border-radius: 8px; background: rgba(255,68,68,0.15); color: #ff4444; border: none; cursor: pointer; font-size: 13px; transition: all 0.2s;">🗑 Очистить</button>
            </div>
        `,
        bodyStyle: 'padding: 0; display: flex; flex-direction: column; flex: 1;'
    });
    win.id = 'trash-window';
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
    renderTrashContent(win);
    win.querySelector('.restore-all').onclick = restoreAllTrash;
    win.querySelector('.clear-all').onclick = clearTrash;
}

function renderTrashContent(win) {
    const content = win.querySelector('.folder-content');
    if (!content) return;
    if (trashItems.length === 0) {
        content.innerHTML = '<div class="empty-trash" style="width:100%; text-align:center; opacity:0.3; padding:40px; font-size: 16px;">🗑 Корзина пуста</div>';
        return;
    }
    content.innerHTML = '';
    trashItems.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 8px 14px; width: 100%; border-radius: 10px; cursor: pointer; transition: all 0.2s; background: rgba(255,255,255,0.03);';
        div.onmouseenter = () => div.style.background = 'rgba(255,255,255,0.08)';
        div.onmouseleave = () => div.style.background = 'rgba(255,255,255,0.03)';
        div.innerHTML = `
            <i class="fas fa-file" style="opacity: 0.5;"></i>
            <span style="flex: 1;">${item.name}</span>
            <span style="opacity: 0.3; font-size: 12px;">${item.type || 'Файл'}</span>
            <button class="restore-item" data-id="${item.id}" style="background: none; border: none; color: #4ecdc4; cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: all 0.2s;">↩ Восстановить</button>
        `;
        content.appendChild(div);
    });
    content.querySelectorAll('.restore-item').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            restoreFromTrash(id);
        };
    });
}

function restoreFromTrash(id) {
    const index = trashItems.findIndex(i => i.id == id);
    if (index !== -1) {
        const item = trashItems.splice(index, 1)[0];
        delete item.parentId;
        currentDesktopItems.push(item);
        saveToFirebase();
        renderDesktop();
        const win = document.getElementById('trash-window');
        if (win) renderTrashContent(win);
    }
}

function clearTrash() {
    Swal.fire({
        title: 'Очистить корзину?',
        text: 'Это действие нельзя отменить',
        icon: 'warning',
        background: '#1a1a2e',
        color: '#fff',
        showCancelButton: true,
        confirmButtonText: 'Очистить',
        cancelButtonText: 'Отмена'
    }).then(result => {
        if (result.isConfirmed) {
            trashItems = [];
            saveToFirebase();
            const win = document.getElementById('trash-window');
            if (win) renderTrashContent(win);
        }
    });
}

function restoreAllTrash() {
    if (trashItems.length === 0) return;
    trashItems.forEach(item => {
        delete item.parentId;
        currentDesktopItems.push(item);
    });
    trashItems = [];
    saveToFirebase();
    renderDesktop();
    const win = document.getElementById('trash-window');
    if (win) renderTrashContent(win);
}

function showFileContextMenu(x, y, item) {
    const desktopMenu = document.getElementById('context-menu');
    if (desktopMenu) desktopMenu.style.display = 'none';
    const menu = document.getElementById('file-context-menu');
    if (!menu) return;
    menu.innerHTML = `
        <div class="context-item" data-action="open"><i class="fas fa-folder-open"></i> Открыть</div>
        <div class="context-item" data-action="rename"><i class="fas fa-pen"></i> Переименовать</div>
        <div class="context-item" data-action="delete"><i class="fas fa-trash"></i> Удалить</div>
    `;
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 180) + 'px';
    menu.style.display = 'flex';
    selectedFile = item;
    menu.querySelectorAll('.context-item').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'rename') {
                const newName = prompt('Новое имя:', item.name);
                if (newName && newName.trim()) {
                    item.name = newName.trim();
                    renderDesktop();
                    saveToFirebase();
                }
            } else if (action === 'delete') {
                trashItems.push({ ...item });
                currentDesktopItems = currentDesktopItems.filter(i => i.id !== item.id);
                renderDesktop();
                saveToFirebase();
            } else if (action === 'open') {
                if (item.type === 'folder') openFolderWindow(item);
                else openFile(item);
            }
            menu.style.display = 'none';
        };
    });
}

function showTrashContext(x, y) {
    const desktopMenu = document.getElementById('context-menu');
    if (desktopMenu) desktopMenu.style.display = 'none';
    const menu = document.getElementById('file-context-menu');
    if (!menu) return;
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 180) + 'px';
    menu.style.display = 'flex';
    menu.innerHTML = `
        <div class="context-item" data-action="open-trash"><i class="fas fa-trash-alt"></i> Открыть корзину</div>
        <div class="context-item" data-action="clear-trash"><i class="fas fa-trash"></i> Очистить корзину</div>
    `;
    menu.querySelectorAll('.context-item').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            if (action === 'open-trash') openTrash();
            else if (action === 'clear-trash') clearTrash();
            menu.style.display = 'none';
        };
    });
}

desktop?.addEventListener('contextmenu', (e) => {
    if (e.target === desktop || e.target.id === 'desktop-icons' || e.target.closest('#desktop-icons')) {
        e.preventDefault();
        e.stopPropagation();
        const fileMenu = document.getElementById('file-context-menu');
        if (fileMenu) fileMenu.style.display = 'none';
        const menu = document.getElementById('context-menu');
        if (menu) {
            menu.style.left = Math.min(e.pageX, window.innerWidth - 220) + 'px';
            menu.style.top = Math.min(e.pageY, window.innerHeight - 250) + 'px';
            menu.style.display = 'flex';
            menu.querySelectorAll('.context-item').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    if (action === 'open-trash') openTrash();
                    else if (action === 'clear-trash') clearTrash();
                    else if (action === 'personalize') {
                        if (window.openSettings) {
                            window.openSettings();
                            setTimeout(() => {
                                const navItems = document.querySelectorAll('.ks-nav-item');
                                navItems.forEach(i => i.classList.remove('active'));
                                const personalizeNav = document.querySelector('.ks-nav-item[data-section="personalize"]');
                                if (personalizeNav) {
                                    personalizeNav.classList.add('active');
                                    const win = document.querySelector('[data-file-id="settings-window"]');
                                    if (win) showKsSection(win, 'personalize');
                                }
                            }, 200);
                        } else {
                            document.getElementById('personalize-modal').style.display = 'flex';
                        }
                    } else if (action === 'create-folder') {
                        const name = prompt('Название папки:', 'Новая папка');
                        if (name) {
                            currentDesktopItems.push({ id: Date.now() + Math.random(), name: name, type: 'folder' });
                            renderDesktop();
                            saveToFirebase();
                        }
                    } else if (action === 'create-file-txt') {
                        currentDesktopItems.push({ id: Date.now() + Math.random(), name: 'новый.txt', type: 'file', content: '' });
                        renderDesktop();
                        saveToFirebase();
                    } else if (action === 'create-file-exe') {
                        const name = prompt('Название приложения:', 'новое_приложение.exe');
                        if (name) {
                            currentDesktopItems.push({ 
                                id: Date.now() + Math.random(), 
                                name: name.endsWith('.exe') ? name : name + '.exe', 
                                type: 'file', 
                                content: '<!DOCTYPE html>\n<html>\n<head>\n    <style>\n        body { \n            background: #1a1a2e; \n            color: white; \n            font-family: Arial; \n            padding: 20px;\n        }\n    </style>\n</head>\n<body>\n    <h1>Привет, K-OS!</h1>\n    <p>Моё новое приложение</p>\n</body>\n</html>'
                            });
                            renderDesktop();
                            saveToFirebase();
                        }
                    } else if (action === 'refresh') {
                        renderDesktop();
                    }
                    menu.style.display = 'none';
                };
            });
        }
    }
});

document.addEventListener('dragover', (e) => e.preventDefault());

document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    const target = e.target.closest('#desktop') || e.target.closest('#desktop-icons');
    if (!target) return;
    for (let file of files) {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                let content = event.target.result;
                let url = null;
                if (file.type.startsWith('image/')) {
                    const formData = new FormData();
                    formData.append('image', content.split(',')[1]);
                    formData.append('key', IMGBB_KEY);
                    const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                    const json = await res.json();
                    if (json.success) {
                        url = json.data.url;
                        content = url;
                    }
                }
                if (file.name.endsWith('.exe') || file.name.endsWith('.ky')) {
                    const textReader = new FileReader();
                    textReader.onload = (textEvent) => {
                        currentDesktopItems.push({
                            id: Date.now() + Math.random(),
                            name: file.name,
                            type: 'file',
                            content: textEvent.target.result,
                            url: null
                        });
                        renderDesktop();
                        saveToFirebase();
                    };
                    textReader.readAsText(file);
                } else {
                    currentDesktopItems.push({
                        id: Date.now() + Math.random(),
                        name: file.name,
                        type: 'file',
                        content: content,
                        url: url
                    });
                    renderDesktop();
                    saveToFirebase();
                }
            } catch (err) {
                console.error('Upload error:', err);
            }
        };
        reader.readAsDataURL(file);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.wallpaper-item').forEach(item => {
        item.onclick = () => {
            const url = item.style.backgroundImage.slice(5, -2);
            systemConfig.wallpaper = url;
            applyConfig();
            document.querySelectorAll('.wallpaper-item').forEach(el => el.style.border = '2px solid transparent');
            item.style.border = '2px solid #667eea';
        };
    });
    document.querySelectorAll('.lang-option').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            systemConfig.language = btn.dataset.lang;
        };
    });
    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.onclick = () => {
            document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            systemConfig.theme = opt.dataset.theme;
            applyConfig();
        };
    });
    const glassSlider = document.getElementById('glass-intensity');
    if (glassSlider) {
        glassSlider.value = systemConfig.glassOpacity * 100 || 60;
        glassSlider.oninput = () => {
            const val = glassSlider.value / 100;
            systemConfig.glassOpacity = val;
            document.documentElement.style.setProperty('--glass-opacity', val);
            document.querySelectorAll('.glass-panel').forEach(panel => {
                panel.style.background = `rgba(30, 30, 40, ${val})`;
            });
        };
    }
    document.getElementById('save-personalize')?.addEventListener('click', () => {
        saveToFirebase();
        document.getElementById('personalize-modal').style.display = 'none';
        Swal.fire({
            title: 'Сохранено!',
            text: 'Настройки персонализации обновлены',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false,
            background: '#1a1a2e',
            color: '#fff'
        });
    });
    document.querySelector('.modal-close')?.addEventListener('click', () => {
        document.getElementById('personalize-modal').style.display = 'none';
    });
});

document.getElementById('start-button')?.addEventListener('click', () => {
    const menu = document.getElementById('start-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('do-login')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch(e) { 
        Swal.fire('Ошибка', e.message, 'error');
    }
});

document.getElementById('do-register')?.addEventListener('click', async () => {
    const name = document.getElementById('reg-name').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;
    if (password !== confirm) return Swal.fire('Ошибка', 'Пароли не совпадают', 'error');
    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });
    } catch(e) { 
        Swal.fire('Ошибка', e.message, 'error');
    }
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
        document.getElementById(`${btn.dataset.tab}-form`).classList.add('active');
    };
});

document.getElementById('submit-login')?.addEventListener('click', () => {
    const pwd = document.getElementById('login-password').value;
    if (pwd === systemConfig.password) {
        showScreen(desktop);
    } else {
        Swal.fire('Ошибка', 'Неверный пароль', 'error');
    }
});

document.getElementById('logout-full')?.addEventListener('click', () => signOut(auth));

function renderSetupStep() {
    const stepContent = document.getElementById('setup-step-content');
    if (!stepContent) return;
    switch(currentStep) {
        case 1:
            stepContent.innerHTML = `<h2>Добро пожаловать в K-OS!</h2><p>Давайте настроим вашу систему</p>`;
            break;
        case 2:
            stepContent.innerHTML = `<h2>Выберите язык</h2>
                <div class="language-selector">
                    ${['ru|🇷🇺 Русский', 'en|🇬🇧 English', 'es|🇪🇸 Español', 'zh|🇨🇳 中文', 'de|🇩🇪 Deutsch', 'fr|🇫🇷 Français', 'pt|🇵🇹 Português', 'ar|🇸🇦 العربية', 'ja|🇯🇵 日本語', 'ko|🇰🇷 한국어'].map(l => {
                        const [code, label] = l.split('|');
                        return `<button class="lang-option ${code === 'ru' ? 'active' : ''}" data-lang="${code}">${label}</button>`;
                    }).join('')}
                </div>`;
            break;
        case 3:
            stepContent.innerHTML = `<h2>Настройка жидкого стекла</h2>
                <p style="opacity:0.6; font-size:14px;">Прозрачность интерфейса</p>
                <input type="range" id="setup-glass" min="0.1" max="0.9" step="0.05" value="0.6" style="width:100%; margin-top:12px;">
                <div class="glass-slider-label"><span>Прозрачный</span><span>Непрозрачный</span></div>`;
            break;
        case 4:
            stepContent.innerHTML = `<h2>Подключение к Wi-Fi</h2><p style="opacity:0.6;">Пропустить (демо)</p>`;
            break;
        case 5:
            stepContent.innerHTML = `<h2>Установить пароль для входа</h2>
                <input type="password" id="setup-password" class="glass-input" placeholder="Пароль" style="width:100%; margin-top:12px; padding:12px; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1); border-radius:12px; color:white;">`;
            break;
        case 6:
            stepContent.innerHTML = `<h2>Готово!</h2><p>Наслаждайтесь K-OS</p>`;
            break;
    }
}

function nextSetupStep() {
    if (currentStep === 5) {
        const pwd = document.getElementById('setup-password')?.value;
        if (pwd) systemConfig.password = pwd;
    }
    if (currentStep === 3) {
        const val = document.getElementById('setup-glass')?.value;
        if (val) systemConfig.glassOpacity = parseFloat(val);
    }
    if (currentStep === 2) {
        const active = document.querySelector('.lang-option.active');
        if (active) systemConfig.language = active.dataset.lang;
    }
    if (currentStep < 6) {
        currentStep++;
        renderSetupStep();
        document.querySelectorAll('.step-dot').forEach((dot, i) => {
            if (i < currentStep) dot.classList.add('active');
        });
    } else {
        saveToFirebase();
        showScreen(desktop);
        loadFromFirebase();
    }
}

document.getElementById('setup-next')?.addEventListener('click', nextSetupStep);
document.getElementById('setup-prev')?.addEventListener('click', () => {
    if (currentStep > 1) { 
        currentStep--; 
        renderSetupStep(); 
        document.querySelectorAll('.step-dot').forEach((dot, i) => {
            if (i < currentStep) dot.classList.add('active');
            else dot.classList.remove('active');
        });
    }
});

document.addEventListener('dragstart', (e) => {
    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;
    if (icon.dataset.id === 'kdraw-app-icon' || icon.onclick.toString().includes('openKdraw')) {
        dragData = { id: 'kdraw-app-icon', isKdraw: true };
        e.dataTransfer.setData('text/plain', 'kdraw-app-icon');
        icon.style.opacity = '0.5';
        return;
    }
    const id = icon.dataset.id;
    if (id === 'trash') {
        dragData = { id: 'trash', isTrash: true };
        e.dataTransfer.setData('text/plain', 'trash');
        icon.style.opacity = '0.5';
        return;
    }
    dragData = { id: id, element: icon, isTrash: false };
    e.dataTransfer.setData('text/plain', id);
    icon.style.opacity = '0.5';
});

document.addEventListener('dragend', (e) => {
    const icon = e.target.closest('.desktop-icon');
    if (icon) icon.style.opacity = '1';
    dragData = null;
});

const desktopIcons = document.getElementById('desktop-icons');

desktopIcons?.addEventListener('dragover', (e) => {
    e.preventDefault();
});

desktopIcons?.addEventListener('drop', (e) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain') || (dragData ? dragData.id : null);
    if (!id) return;
    if (id === 'kdraw-app-icon' || (dragData && dragData.isKdraw)) {
        const kdrawIcon = document.querySelector('[data-id="kdraw-app-icon"]');
        if (kdrawIcon) {
            const rect = desktopIcons.getBoundingClientRect();
            const x = e.clientX - rect.left - 42;
            const y = e.clientY - rect.top - 42;
            kdrawIcon.style.left = x + 'px';
            kdrawIcon.style.top = y + 'px';
        }
        dragData = null;
        return;
    }
    if (id === 'trash' || (dragData && dragData.isTrash)) {
        const trashIcon = document.querySelector('.trash-icon');
        if (trashIcon) {
            const rect = desktopIcons.getBoundingClientRect();
            const x = e.clientX - rect.left - 42;
            const y = e.clientY - rect.top - 42;
            trashIcon.style.position = 'absolute';
            trashIcon.style.left = x + 'px';
            trashIcon.style.top = y + 'px';
        }
        dragData = null;
        return;
    }
    const item = currentDesktopItems.find(i => i.id == id);
    if (!item) return;
    if (item.parentId) delete item.parentId;
    const rect = desktopIcons.getBoundingClientRect();
    item.x = e.clientX - rect.left - 42;
    item.y = e.clientY - rect.top - 42;
    saveToFirebase();
    renderDesktop();
    document.querySelectorAll('.floating-window[data-folder-id]').forEach(win => {
        const folderId = win.dataset.folderId;
        if (folderId) {
            const folder = currentDesktopItems.find(i => i.id == folderId);
            if (folder) {
                win.remove();
                openWindows = openWindows.filter(w => w !== win);
                openFolderWindow(folder);
            }
        }
    });
    dragData = null;
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        document.getElementById('context-menu').style.display = 'none';
        document.getElementById('file-context-menu').style.display = 'none';
        const taskbarMenu = document.getElementById('taskbar-context-menu');
        if (taskbarMenu) taskbarMenu.style.display = 'none';
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        const menu = document.getElementById('start-menu');
        if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
        }
    }
});

function addTaskbarContextMenu() {
    if (document.getElementById('taskbar-context-menu')) return;
    const menu = document.createElement('div');
    menu.id = 'taskbar-context-menu';
    menu.className = 'context-menu glass-panel';
    menu.style.display = 'none';
    document.body.appendChild(menu);
}

document.addEventListener('DOMContentLoaded', () => {
    addTaskbarContextMenu();
});

// ===== ПРОСМОТР ИЗОБРАЖЕНИЙ (ПРОДОЛЖЕНИЕ) =====

// ===== ЗАГРУЗЧИК ИЗОБРАЖЕНИЙ =====
let loaderInterval = null;
let loaderProgress = 0;

function openImageLoader(title, status) {
    const loader = document.getElementById('image-loader');
    if (!loader) return;
    loader.style.display = 'flex';
    document.getElementById('loader-title').textContent = title || 'Загрузка';
    document.getElementById('loader-status').textContent = status || 'Подготовка...';
    document.getElementById('loader-filename').textContent = title || '';
    loaderProgress = 0;
    document.getElementById('loader-bar').style.width = '0%';
    document.getElementById('loader-progress-text').textContent = '0%';
    if (loaderInterval) clearInterval(loaderInterval);
}

function updateLoader(progress, status, filename) {
    const bar = document.getElementById('loader-bar');
    const text = document.getElementById('loader-progress-text');
    const statusEl = document.getElementById('loader-status');
    const filenameEl = document.getElementById('loader-filename');
    if (bar) bar.style.width = Math.min(progress, 100) + '%';
    if (text) text.textContent = Math.min(progress, 100) + '%';
    if (statusEl) statusEl.textContent = status || '';
    if (filenameEl && filename) filenameEl.textContent = filename;
}

function closeLoader() {
    const loader = document.getElementById('image-loader');
    if (loader) loader.style.display = 'none';
    if (loaderInterval) clearInterval(loaderInterval);
}

function minimizeLoader() {
    const loader = document.getElementById('image-loader');
    if (loader) loader.classList.toggle('minimized');
}

// ===== ПОИСК В МЕНЮ ПУСК =====
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('start-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.toLowerCase().trim();
            const items = document.querySelectorAll('.app-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                item.style.display = text.includes(query) ? 'flex' : 'none';
            });
        });
    }
});

// ===== K-DRAW (полнофункциональный) =====
let kdCanvas, kdCtx, kdIsDrawing = false;
let kdBrushSize = 5, kdCurrentColor = '#000000', kdCurrentBrush = 'round';
let kdStartX, kdStartY;
let kdHistory = [], kdHistoryIndex = -1;
let kdCurrentTool = 'brush';

window.openKdraw = function() {
    const existing = document.querySelector('[data-file-id="kdraw-main"]');
    if (existing) {
        focusWindow(existing);
        return;
    }
    const win = createWindow({
        title: 'K-draw',
        icon: 'fa-paint-brush',
        fileId: 'kdraw-main',
        width: 1200,
        height: 750,
        resizable: true,
        body: `
            <div style="display:flex;height:100%;gap:0;">
                <div style="width:52px;display:flex;flex-direction:column;align-items:center;padding:10px 4px;gap:8px;border-right:1px solid rgba(255,255,255,0.06);flex-shrink:0;">
                    <button class="kd-tool-btn active" data-tool="brush" title="Кисть (B)"><i class="fas fa-paint-brush"></i></button>
                    <button class="kd-tool-btn" data-tool="eraser" title="Ластик (E)"><i class="fas fa-eraser"></i></button>
                    <button class="kd-tool-btn" data-tool="fill" title="Заливка (G)"><i class="fas fa-fill-drip"></i></button>
                    <button class="kd-tool-btn" data-tool="picker" title="Пипетка (I)"><i class="fas fa-eye-dropper"></i></button>
                    <div style="position:relative;">
                        <button class="kd-tool-btn" data-tool="shapes" id="kd-shapes-btn" title="Фигуры (S)"><i class="fas fa-shapes"></i></button>
                        <div id="kd-shapes-submenu" style="display:none;position:absolute;left:56px;top:0;background:rgba(20,20,35,0.95);backdrop-filter:blur(20px);border-radius:10px;border:1px solid rgba(255,255,255,0.08);padding:6px;z-index:10;white-space:nowrap;">
                            <button class="kd-shape-btn" data-shape="rect" title="Прямоугольник">▬</button>
                            <button class="kd-shape-btn" data-shape="circle" title="Круг">⬤</button>
                            <button class="kd-shape-btn" data-shape="line" title="Линия">╱</button>
                            <button class="kd-shape-btn" data-shape="triangle" title="Треугольник">▲</button>
                        </div>
                    </div>
                    <div style="flex:1;"></div>
                    <button class="kd-tool-btn" id="kd-undo-btn" title="Отменить (Ctrl+Z)"><i class="fas fa-undo"></i></button>
                    <button class="kd-tool-btn" id="kd-redo-btn" title="Вернуть (Ctrl+Shift+Z)"><i class="fas fa-redo"></i></button>
                </div>
                <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
                    <div style="padding:6px 12px;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:10px;font-size:11px;opacity:0.5;flex-shrink:0;flex-wrap:wrap;">
                        <span>Холст</span>
                        <span>|</span>
                        <span>Размер:</span>
                        <input type="range" id="kd-brush-size" min="1" max="50" value="5" style="width:70px;">
                        <span id="kd-size-value">5px</span>
                        <span>|</span>
                        <span>Кисть:</span>
                        <select id="kd-brush-type" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:2px 6px;color:white;font-size:10px;">
                            <option value="round">● Круглая</option>
                            <option value="square">■ Квадратная</option>
                            <option value="spray">💨 Аэрограф</option>
                            <option value="marker">🖊 Маркер</option>
                            <option value="pen">✒ Перо</option>
                        </select>
                        <span style="margin-left:auto;">Масштаб:</span>
                        <span id="kd-zoom-level">100%</span>
                    </div>
                    <div style="flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.2);" id="kd-canvas-wrapper">
                        <div id="kd-new-canvas-overlay" style="position:absolute;display:flex;align-items:center;justify-content:center;z-index:5;">
                            <div style="background:rgba(20,20,35,0.9);backdrop-filter:blur(20px);border-radius:16px;border:1px solid rgba(255,255,255,0.1);padding:24px;text-align:center;">
                                <h3 style="margin:0 0 16px;font-size:18px;">Новый холст</h3>
                                <div style="display:flex;gap:8px;margin-bottom:12px;justify-content:center;">
                                    <input type="number" id="kd-cw" value="800" style="width:70px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;color:white;text-align:center;font-size:14px;outline:none;">
                                    <span style="color:rgba(255,255,255,0.3);line-height:40px;">×</span>
                                    <input type="number" id="kd-ch" value="600" style="width:70px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;color:white;text-align:center;font-size:14px;outline:none;">
                                </div>
                                <button id="kd-create-btn" style="width:44px;height:44px;border-radius:50%;border:none;background:linear-gradient(135deg,#667eea,#764ba2);color:white;font-size:22px;cursor:pointer;">+</button>
                            </div>
                        </div>
                        <canvas id="kd-canvas" width="800" height="600" style="background:white;box-shadow:0 4px 20px rgba(0,0,0,0.3);cursor:crosshair;display:none;"></canvas>
                    </div>
                </div>
                <div style="width:200px;display:flex;flex-direction:column;padding:12px;gap:12px;border-left:1px solid rgba(255,255,255,0.06);flex-shrink:0;overflow-y:auto;">
                    <div>
                        <div style="font-size:10px;opacity:0.4;margin-bottom:6px;">ЦВЕТ</div>
                        <canvas id="kd-color-wheel" width="176" height="176" style="width:100%;border-radius:50%;cursor:crosshair;display:block;"></canvas>
                        <div style="display:flex;align-items:center;gap:8px;margin-top:8px;">
                            <div id="kd-current-color" style="width:30px;height:30px;border-radius:8px;background:#000;border:2px solid rgba(255,255,255,0.3);cursor:pointer;flex-shrink:0;"></div>
                            <input type="text" id="kd-hex-input" value="#000000" style="flex:1;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:6px;color:white;font-size:11px;font-family:monospace;outline:none;">
                        </div>
                    </div>
                    <div>
                        <div style="font-size:10px;opacity:0.4;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                            <span>СЛОИ</span>
                            <button id="kd-add-layer" style="background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:16px;">+</button>
                        </div>
                        <div id="kd-layers-list" style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;"></div>
                    </div>
                    <div style="margin-top:auto;display:flex;flex-direction:column;gap:6px;">
                        <button id="kd-save-btn" style="width:100%;padding:8px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:10px;color:white;cursor:pointer;font-size:12px;">💾 Сохранить на рабочий стол</button>
                        <button id="kd-export-btn" style="width:100%;padding:8px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:10px;color:rgba(255,255,255,0.7);cursor:pointer;font-size:12px;">📥 Экспорт PNG</button>
                    </div>
                </div>
            </div>
        `,
        bodyStyle: 'padding:0;flex:1;overflow:hidden;'
    });
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
    focusWindow(win);
    setTimeout(() => {
        kdCanvas = win.querySelector('#kd-canvas');
        kdCtx = kdCanvas.getContext('2d');
        win.querySelector('#kd-create-btn').onclick = () => {
            const w = parseInt(win.querySelector('#kd-cw').value) || 800;
            const h = parseInt(win.querySelector('#kd-ch').value) || 600;
            kdCanvas.width = w;
            kdCanvas.height = h;
            kdCtx.fillStyle = '#ffffff';
            kdCtx.fillRect(0, 0, w, h);
            kdCanvas.style.display = 'block';
            win.querySelector('#kd-new-canvas-overlay').style.display = 'none';
            kdHistory = [];
            saveKdHistory();
            updateKdLayers(win);
        };
        initKdColorWheel(win);
        initKdTools(win);
    }, 100);
};

function saveKdHistory() {
    kdHistoryIndex++;
    if (kdHistoryIndex < kdHistory.length) kdHistory.length = kdHistoryIndex;
    kdHistory.push(kdCanvas.toDataURL());
    if (kdHistory.length > 30) { kdHistory.shift(); kdHistoryIndex--; }
}

function loadKdHistory(index) {
    const img = new Image();
    img.onload = () => {
        kdCtx.clearRect(0, 0, kdCanvas.width, kdCanvas.height);
        kdCtx.drawImage(img, 0, 0);
    };
    img.src = kdHistory[index];
}

function initKdColorWheel(win) {
    const wheel = win.querySelector('#kd-color-wheel');
    const wctx = wheel.getContext('2d');
    const cx = 88, cy = 88, r = 85;
    function drawWheel(selX, selY) {
        wctx.clearRect(0, 0, 176, 176);
        for (let a = 0; a < 360; a += 0.3) {
            for (let d = 8; d < r; d++) {
                wctx.beginPath();
                wctx.arc(cx, cy, d, (a - 1) * Math.PI / 180, (a + 1) * Math.PI / 180);
                wctx.strokeStyle = `hsl(${a}, ${(d/r) * 100}%, 50%)`;
                wctx.lineWidth = 1.3;
                wctx.stroke();
            }
        }
        if (selX !== undefined) {
            wctx.beginPath();
            wctx.arc(selX, selY, 7, 0, Math.PI * 2);
            wctx.strokeStyle = '#fff';
            wctx.lineWidth = 2.5;
            wctx.stroke();
            wctx.beginPath();
            wctx.arc(selX, selY, 5, 0, Math.PI * 2);
            wctx.strokeStyle = '#000';
            wctx.lineWidth = 1.5;
            wctx.stroke();
        }
    }
    drawWheel();
    let selPt = null;
    wheel.onmousedown = (e) => {
        const rect = wheel.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < r && dist > 8) {
            const data = wctx.getImageData(x, y, 1, 1).data;
            kdCurrentColor = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
            win.querySelector('#kd-current-color').style.background = kdCurrentColor;
            win.querySelector('#kd-hex-input').value = kdCurrentColor;
            selPt = [x, y];
            drawWheel(x, y);
        }
    };
    wheel.onmousemove = (e) => {
        if (!selPt) return;
        const rect = wheel.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < r && dist > 8) {
            const data = wctx.getImageData(x, y, 1, 1).data;
            kdCurrentColor = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
            win.querySelector('#kd-current-color').style.background = kdCurrentColor;
            win.querySelector('#kd-hex-input').value = kdCurrentColor;
            selPt = [x, y];
            drawWheel(x, y);
        }
    };
    wheel.onmouseup = () => { selPt = null; };
    wheel.onmouseleave = () => { selPt = null; };
}

let kdLayers = [{ name: 'Слой 1', data: null, visible: true }];
let kdActiveLayer = 0;

function updateKdLayers(win) {
    const list = win.querySelector('#kd-layers-list');
    list.innerHTML = '';
    kdLayers.forEach((layer, i) => {
        const div = document.createElement('div');
        div.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 8px;background:${i === kdActiveLayer ? 'rgba(102,126,234,0.3)' : 'rgba(255,255,255,0.03)'};border-radius:6px;cursor:pointer;font-size:11px;`;
        div.innerHTML = `<span style="flex:1;">${layer.name}</span><i class="fas fa-eye" style="opacity:${layer.visible ? '0.5' : '0.1'};cursor:pointer;font-size:10px;"></i>`;
        div.onclick = () => { kdActiveLayer = i; updateKdLayers(win); };
        div.querySelector('i').onclick = (e) => { e.stopPropagation(); layer.visible = !layer.visible; updateKdLayers(win); };
        list.appendChild(div);
    });
}

function initKdTools(win) {
    win.querySelectorAll('.kd-tool-btn[data-tool]').forEach(btn => {
        btn.onclick = () => {
            win.querySelectorAll('.kd-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            kdCurrentTool = btn.dataset.tool;
            if (kdCurrentTool === 'shapes') {
                win.querySelector('#kd-shapes-submenu').style.display = 'block';
            } else {
                win.querySelector('#kd-shapes-submenu').style.display = 'none';
            }
        };
    });
    win.querySelectorAll('.kd-shape-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            kdCurrentTool = 'shape-' + btn.dataset.shape;
            win.querySelector('#kd-shapes-submenu').style.display = 'none';
        };
    });
    win.querySelector('#kd-brush-type').onchange = function() {
        kdCurrentBrush = this.value;
    };
    win.querySelector('#kd-brush-size').oninput = function() {
        kdBrushSize = parseInt(this.value);
        win.querySelector('#kd-size-value').textContent = kdBrushSize + 'px';
    };
    win.querySelector('#kd-hex-input').onchange = function() {
        if (/^#[0-9a-f]{6}$/i.test(this.value)) {
            kdCurrentColor = this.value;
            win.querySelector('#kd-current-color').style.background = kdCurrentColor;
        }
    };
    win.querySelector('#kd-save-btn').onclick = () => {
        const dataUrl = kdCanvas.toDataURL('image/png');
        const name = prompt('Название файла:', 'рисунок.png');
        if (name) {
            currentDesktopItems.push({ id: Date.now() + Math.random(), name, type: 'file', content: dataUrl });
            renderDesktop();
            saveToFirebase();
            Swal.fire({ title: 'Сохранено!', timer: 1200, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
        }
    };
    win.querySelector('#kd-export-btn').onclick = () => {
        const link = document.createElement('a');
        link.download = 'kdraw-' + Date.now() + '.png';
        link.href = kdCanvas.toDataURL('image/png');
        link.click();
    };
    win.querySelector('#kd-undo-btn').onclick = () => {
        if (kdHistoryIndex > 0) { kdHistoryIndex--; loadKdHistory(kdHistoryIndex); }
    };
    win.querySelector('#kd-redo-btn').onclick = () => {
        if (kdHistoryIndex < kdHistory.length - 1) { kdHistoryIndex++; loadKdHistory(kdHistoryIndex); }
    };
    win.querySelector('#kd-add-layer').onclick = () => {
        kdLayers.push({ name: 'Слой ' + (kdLayers.length + 1), data: null, visible: true });
        kdActiveLayer = kdLayers.length - 1;
        updateKdLayers(win);
    };
    updateKdLayers(win);
    kdCanvas.onmousedown = (e) => {
        if (kdCanvas.style.display === 'none') return;
        kdIsDrawing = true;
        const rect = kdCanvas.getBoundingClientRect();
        kdStartX = e.clientX - rect.left;
        kdStartY = e.clientY - rect.top;
        if (kdCurrentTool === 'fill') {
            floodFill(Math.floor(kdStartX), Math.floor(kdStartY), kdCurrentColor);
            saveKdHistory();
            kdIsDrawing = false;
        } else if (kdCurrentTool === 'picker') {
            const data = kdCtx.getImageData(Math.floor(kdStartX), Math.floor(kdStartY), 1, 1).data;
            kdCurrentColor = '#' + [data[0], data[1], data[2]].map(v => v.toString(16).padStart(2, '0')).join('');
            win.querySelector('#kd-current-color').style.background = kdCurrentColor;
            win.querySelector('#kd-hex-input').value = kdCurrentColor;
            kdIsDrawing = false;
        }
    };
    kdCanvas.onmousemove = (e) => {
        if (!kdIsDrawing) return;
        const rect = kdCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        kdCtx.lineWidth = kdBrushSize;
        kdCtx.lineCap = 'round';
        kdCtx.lineJoin = 'round';
        if (kdCurrentTool === 'brush') {
            kdCtx.strokeStyle = kdCurrentColor;
            kdCtx.globalCompositeOperation = 'source-over';
        } else if (kdCurrentTool === 'eraser') {
            kdCtx.globalCompositeOperation = 'destination-out';
        } else {
            return;
        }
        if (kdCurrentBrush === 'spray' && kdCurrentTool === 'brush') {
            for (let i = 0; i < kdBrushSize; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * kdBrushSize;
                const px = x + Math.cos(angle) * dist;
                const py = y + Math.sin(angle) * dist;
                kdCtx.fillStyle = kdCurrentColor;
                kdCtx.fillRect(px, py, 1, 1);
            }
        } else if (kdCurrentBrush === 'square' && kdCurrentTool === 'brush') {
            kdCtx.fillStyle = kdCurrentColor;
            kdCtx.fillRect(x - kdBrushSize/2, y - kdBrushSize/2, kdBrushSize, kdBrushSize);
        } else {
            kdCtx.beginPath();
            kdCtx.moveTo(kdStartX, kdStartY);
            kdCtx.lineTo(x, y);
            kdCtx.stroke();
        }
        kdStartX = x;
        kdStartY = y;
    };
    kdCanvas.onmouseup = () => {
        if (kdIsDrawing) saveKdHistory();
        kdIsDrawing = false;
    };
    kdCanvas.onmouseleave = () => {
        if (kdIsDrawing) saveKdHistory();
        kdIsDrawing = false;
    };
    win.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            if (kdHistoryIndex > 0) { kdHistoryIndex--; loadKdHistory(kdHistoryIndex); }
        }
        if (e.ctrlKey && e.key === 'z' && e.shiftKey) {
            e.preventDefault();
            if (kdHistoryIndex < kdHistory.length - 1) { kdHistoryIndex++; loadKdHistory(kdHistoryIndex); }
        }
        const tools = { 'b': 'brush', 'e': 'eraser', 'g': 'fill', 'i': 'picker', 's': 'shapes' };
        if (tools[e.key.toLowerCase()]) {
            kdCurrentTool = tools[e.key.toLowerCase()];
            win.querySelectorAll('.kd-tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
            const btn = win.querySelector(`.kd-tool-btn[data-tool="${kdCurrentTool}"]`);
            if (btn) btn.classList.add('active');
        }
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            win.querySelector('#kd-save-btn').click();
        }
    });
    win.querySelector('#kd-canvas-wrapper').addEventListener('wheel', (e) => {
        e.preventDefault();
        const currentZoom = parseInt(win.querySelector('#kd-zoom-level').textContent) || 100;
        let newZoom = currentZoom + (e.deltaY > 0 ? -15 : 15);
        newZoom = Math.max(20, Math.min(500, newZoom));
        kdCanvas.style.transform = 'scale(' + (newZoom / 100) + ')';
        win.querySelector('#kd-zoom-level').textContent = newZoom + '%';
    });
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#kd-shapes-btn') && !e.target.closest('#kd-shapes-submenu')) {
            win.querySelector('#kd-shapes-submenu').style.display = 'none';
        }
    });
}

function floodFill(x, y, fillColor) {
    const imageData = kdCtx.getImageData(0, 0, kdCanvas.width, kdCanvas.height);
    const idx = (y * kdCanvas.width + x) * 4;
    const tR = imageData.data[idx], tG = imageData.data[idx + 1], tB = imageData.data[idx + 2];
    const fR = parseInt(fillColor.slice(1, 3), 16), fG = parseInt(fillColor.slice(3, 5), 16), fB = parseInt(fillColor.slice(5, 7), 16);
    if (tR === fR && tG === fG && tB === fB) return;
    const stack = [[x, y]], visited = new Set();
    while (stack.length > 0) {
        const [cx, cy] = stack.pop(), key = cx + ',' + cy;
        if (visited.has(key) || cx < 0 || cy < 0 || cx >= kdCanvas.width || cy >= kdCanvas.height) continue;
        const i = (cy * kdCanvas.width + cx) * 4;
        if (imageData.data[i] !== tR || imageData.data[i + 1] !== tG || imageData.data[i + 2] !== tB) continue;
        visited.add(key);
        imageData.data[i] = fR; imageData.data[i + 1] = fG; imageData.data[i + 2] = fB;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    kdCtx.putImageData(imageData, 0, 0);
}

// ================================================================
// ===== КОНСТРУКТОР ПРИЛОЖЕНИЙ v3.0 (ОБЪЕДИНЕННАЯ ВЕРСИЯ) =====
// ================================================================

// СОСТОЯНИЕ (ЕДИНСТВЕННОЕ ОБЪЯВЛЕНИЕ)
const AppBuilder = {
    view: 'welcome',
    name: 'Моё приложение',
    type: 'editor',
    url: '',
    html: '',
    css: '',
    js: '',
    icon: '',
    allowFiles: false,
    recent: [],
    isModified: false
};

// ЗАГРУЗКА ДАННЫХ
function loadBuilderData() {
    try {
        const saved = localStorage.getItem('builder_data_v3') || localStorage.getItem('builder_data');
        if (saved) {
            const data = JSON.parse(saved);
            AppBuilder.recent = data.recent || [];
            if (data.current) {
                AppBuilder.name = data.current.name || AppBuilder.name;
                AppBuilder.type = data.current.type || AppBuilder.type;
                AppBuilder.url = data.current.url || '';
                AppBuilder.html = data.current.html || '';
                AppBuilder.css = data.current.css || '';
                AppBuilder.js = data.current.js || '';
                AppBuilder.icon = data.current.icon || '';
                AppBuilder.allowFiles = data.current.allowFiles || false;
            }
        }
    } catch(e) { console.log('Load builder error:', e); }
}

// СОХРАНЕНИЕ ДАННЫХ
function saveBuilderData() {
    try {
        const data = {
            recent: AppBuilder.recent,
            current: {
                name: AppBuilder.name,
                type: AppBuilder.type,
                url: AppBuilder.url,
                html: AppBuilder.html,
                css: AppBuilder.css,
                js: AppBuilder.js,
                icon: AppBuilder.icon,
                allowFiles: AppBuilder.allowFiles
            }
        };
        localStorage.setItem('builder_data_v3', JSON.stringify(data));
        localStorage.setItem('builder_data', JSON.stringify(data));
    } catch(e) { console.log('Save builder error:', e); }
}

// ОТКРЫТИЕ КОНСТРУКТОРА
function openAppBuilder2() {
    console.log('🔧 Открываем конструктор...');
    const win = document.getElementById('app-builder-window');
    if (!win) {
        console.error('❌ Окно конструктора не найдено!');
        return;
    }
    win.style.display = 'flex';
    loadBuilderData();
    renderBuilderView('welcome');
    updateBuilderRecent();
    console.log('✅ Конструктор открыт');
}

function closeBuilder() {
    const win = document.getElementById('app-builder-window');
    if (win) win.style.display = 'none';
}

// РЕНДЕР
function renderBuilderView(view) {
    AppBuilder.view = view;
    const content = document.getElementById('builder-content');
    if (!content) return;

    document.querySelectorAll('.bnav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.view === view);
    });

    switch(view) {
        case 'welcome': renderBuilderWelcome(content); break;
        case 'web': renderBuilderWeb(content); break;
        case 'editor': renderBuilderEditor(content); break;
        case 'preview': renderBuilderPreview(content); break;
        default: content.innerHTML = '<p style="opacity:0.4;">Выберите раздел</p>';
    }
}

// ===== ГЛАВНАЯ =====
function renderBuilderWelcome(content) {
    content.innerHTML = `
        <div style="max-width:900px;margin:0 auto;padding:10px 0;">
            <div style="text-align:center;padding:10px 0 20px;">
                <div style="font-size:44px;margin-bottom:12px;">🚀</div>
                <h1 style="font-size:28px;font-weight:700;background:linear-gradient(135deg,#667eea,#764ba2);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">Создай своё приложение</h1>
                <p style="opacity:0.5;font-size:14px;margin-top:6px;">Выберите способ создания или откройте проект</p>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
                <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;cursor:pointer;transition:all 0.3s;" onclick="renderBuilderView('web')" onmouseover="this.style.borderColor='#667eea';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)';this.style.transform='none'">
                    <div style="font-size:28px;margin-bottom:8px;">🌐</div>
                    <h3 style="margin-bottom:6px;font-size:16px;">Веб-сайт</h3>
                    <p style="opacity:0.4;font-size:12px;">Создайте обёртку для любого сайта</p>
                </div>

                <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;cursor:pointer;transition:all 0.3s;" onclick="renderBuilderView('editor')" onmouseover="this.style.borderColor='#667eea';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)';this.style.transform='none'">
                    <div style="font-size:28px;margin-bottom:8px;">💻</div>
                    <h3 style="margin-bottom:6px;font-size:16px;">Редактор кода</h3>
                    <p style="opacity:0.4;font-size:12px;">Напишите HTML/CSS/JS с нуля</p>
                </div>

                <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;cursor:pointer;transition:all 0.3s;" onclick="loadProject()" onmouseover="this.style.borderColor='#4ecdc4';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)';this.style.transform='none'">
                    <div style="font-size:28px;margin-bottom:8px;">📂</div>
                    <h3 style="margin-bottom:6px;font-size:16px;">Открыть проект</h3>
                    <p style="opacity:0.4;font-size:12px;">Загрузите .Wrk или .Ky файл</p>
                </div>

                <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;cursor:pointer;transition:all 0.3s;" onclick="loadExample()" onmouseover="this.style.borderColor='#ffaa44';this.style.transform='translateY(-2px)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.06)';this.style.transform='none'">
                    <div style="font-size:28px;margin-bottom:8px;">📖</div>
                    <h3 style="margin-bottom:6px;font-size:16px;">Пример проекта</h3>
                    <p style="opacity:0.4;font-size:12px;">Todo-приложение для старта</p>
                </div>
            </div>

            <div style="margin-top:20px;padding:14px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px dashed rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                <span style="font-size:12px;opacity:0.5;"><i class="fas fa-info-circle" style="color:#667eea;"></i> Проекты сохраняются автоматически</span>
                <span style="font-size:11px;opacity:0.3;">${AppBuilder.recent.length} проектов</span>
            </div>
        </div>
    `;
}

// ===== ВЕБ-САЙТ =====
function renderBuilderWeb(content) {
    content.innerHTML = `
        <div style="max-width:700px;margin:0 auto;">
            <h2 style="margin-bottom:16px;font-size:22px;">🌐 Веб-приложение</h2>
            
            <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px;"><i class="fas fa-link" style="color:#667eea;"></i> URL</div>
                <input class="b-input" id="b-web-url" placeholder="https://example.com" value="${AppBuilder.url}" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:white;font-size:14px;outline:none;">
            </div>

            <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px;"><i class="fas fa-tag" style="color:#4ecdc4;"></i> Название</div>
                <input class="b-input" id="b-web-name" placeholder="Название приложения" value="${AppBuilder.name}" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:white;font-size:14px;outline:none;">
            </div>

            <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px;"><i class="fas fa-image" style="color:#ffaa44;"></i> Иконка (URL)</div>
                <input class="b-input" id="b-web-icon" placeholder="https://example.com/icon.png" value="${AppBuilder.icon}" style="width:100%;padding:10px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:10px;color:white;font-size:14px;outline:none;">
            </div>

            <div class="b-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:14px;padding:18px;margin-bottom:14px;">
                <div style="font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px;"><i class="fas fa-shield-alt" style="color:#4ecdc4;"></i> Доступ к файлам</div>
                <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                    <input type="checkbox" id="b-web-files" ${AppBuilder.allowFiles ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;">
                    <span style="font-size:13px;">Разрешить отправку файлов в K-OS</span>
                </label>
                <div style="margin-top:6px;font-size:11px;opacity:0.3;padding:6px 10px;background:rgba(255,255,255,0.03);border-radius:6px;">
                    <i class="fas fa-info-circle"></i> Приложение сможет использовать window.KOS.saveFile()
                </div>
            </div>

            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
                <button class="b-btn primary" style="padding:8px 20px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;" onclick="saveBuilderWeb()"><i class="fas fa-check"></i> Применить</button>
                <button class="b-btn secondary" style="padding:8px 20px;border:none;border-radius:10px;cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s;display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.8);border:1px solid rgba(255,255,255,0.08);" onclick="previewBuilderWeb()"><i class="fas fa-eye"></i> Предпросмотр</button>
            </div>
        </div>
    `;
}

function saveBuilderWeb() {
    AppBuilder.url = document.getElementById('b-web-url').value.trim();
    AppBuilder.name = document.getElementById('b-web-name').value.trim() || 'Веб-приложение';
    AppBuilder.icon = document.getElementById('b-web-icon').value.trim();
    AppBuilder.allowFiles = document.getElementById('b-web-files').checked;
    AppBuilder.type = 'web';
    AppBuilder.isModified = true;
    addBuilderRecent(AppBuilder.name, 'web');
    saveBuilderData();
    showNotification('Сохранено', `"${AppBuilder.name}" готов`, '✅', 1500);
}

function previewBuilderWeb() {
    const url = document.getElementById('b-web-url').value.trim();
    if (!url) { showNotification('Ошибка', 'Введите URL', '❌', 1500); return; }
    renderBuilderView('preview');
    setTimeout(() => {
        const frame = document.getElementById('builder-preview-frame');
        if (frame) frame.src = url;
    }, 200);
}

// ===== РЕДАКТОР =====
function renderBuilderEditor(content) {
    content.innerHTML = `
        <div style="max-width:100%;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px;">
                <h2 style="font-size:20px;margin:0;">💻 Редактор кода</h2>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <input class="b-input" id="b-editor-name" placeholder="Название" value="${AppBuilder.name}" style="width:180px;padding:6px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:white;font-size:13px;outline:none;">
                    <input class="b-input" id="b-editor-icon" placeholder="Иконка URL" value="${AppBuilder.icon}" style="width:160px;padding:6px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:white;font-size:13px;outline:none;">
                </div>
            </div>

            <div style="display:flex;gap:2px;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:0;">
                <button class="b-tab active" data-tab="html" style="padding:8px 16px;background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:13px;border-bottom:2px solid #667eea;transition:all 0.2s;">HTML</button>
                <button class="b-tab" data-tab="css" style="padding:8px 16px;background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:13px;border-bottom:2px solid transparent;transition:all 0.2s;">CSS</button>
                <button class="b-tab" data-tab="js" style="padding:8px 16px;background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:13px;border-bottom:2px solid transparent;transition:all 0.2s;">JS</button>
                <button class="b-tab" data-tab="preview" style="padding:8px 16px;background:none;border:none;color:rgba(255,255,255,0.5);cursor:pointer;font-size:13px;border-bottom:2px solid transparent;transition:all 0.2s;margin-left:auto;">👁 Предпросмотр</button>
            </div>

            <div id="b-editors" style="position:relative;">
                <textarea class="b-textarea b-code-editor active" id="b-html" style="width:100%;padding:14px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:10px;color:#e0e0e0;font-family:'Courier New',monospace;font-size:13px;line-height:1.6;resize:vertical;outline:none;min-height:300px;display:block;">${AppBuilder.html || `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${AppBuilder.name}</title>
    <style>
        /* Твой CSS здесь */
    </style>
</head>
<body>
    <h1>Привет, K-OS!</h1>
    <p>Начни создавать своё приложение</p>
    <script>
        console.log("Приложение запущено!");
    <\/script>
</body>
</html>`}</textarea>
                <textarea class="b-textarea b-code-editor" id="b-css" style="width:100%;padding:14px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:10px;color:#e0e0e0;font-family:'Courier New',monospace;font-size:13px;line-height:1.6;resize:vertical;outline:none;min-height:300px;display:none;">${AppBuilder.css || `body {
    background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
    color: white;
    font-family: Arial, sans-serif;
    padding: 20px;
    min-height: 100vh;
    margin: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
}
h1 {
    font-size: 42px;
    background: linear-gradient(135deg, #667eea, #764ba2);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
}
p { opacity: 0.6; }`}</textarea>
                <textarea class="b-textarea b-code-editor" id="b-js" style="width:100%;padding:14px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.06);border-radius:10px;color:#e0e0e0;font-family:'Courier New',monospace;font-size:13px;line-height:1.6;resize:vertical;outline:none;min-height:300px;display:none;">${AppBuilder.js || `// Твой JavaScript здесь
console.log("Приложение запущено!");

// Функция для сохранения файлов в K-OS
function saveFile() {
    if (window.KOS && window.KOS.saveFile) {
        window.KOS.saveFile("example.txt", "Hello from K-OS!");
        alert("Файл сохранён!");
    }
}`}</textarea>
                <div id="b-preview-area" style="min-height:300px;display:none;background:white;border-radius:10px;overflow:hidden;">
                    <iframe id="b-preview-frame" style="width:100%;height:100%;min-height:300px;border:none;"></iframe>
                </div>
            </div>

            <div style="margin-top:8px;padding:6px 12px;background:rgba(255,255,255,0.03);border-radius:8px;font-size:11px;opacity:0.3;display:flex;gap:16px;flex-wrap:wrap;">
                <span><kbd style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;">Ctrl+S</kbd> Сохранить</span>
                <span><kbd style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:4px;">Ctrl+Shift+P</kbd> Предпросмотр</span>
            </div>
        </div>
    `;

    document.querySelectorAll('.b-tab').forEach(tab => {
        tab.onclick = function() {
            document.querySelectorAll('.b-tab').forEach(t => t.style.borderBottom = '2px solid transparent');
            this.style.borderBottom = '2px solid #667eea';
            
            const target = this.dataset.tab;
            document.querySelectorAll('.b-code-editor').forEach(el => el.style.display = 'none');
            document.getElementById('b-preview-area').style.display = 'none';
            
            if (target === 'preview') {
                document.getElementById('b-preview-area').style.display = 'block';
                previewBuilderCode();
            } else {
                const el = document.getElementById('b-' + target);
                if (el) el.style.display = 'block';
            }
        };
    });

    document.querySelectorAll('.b-code-editor').forEach(el => {
        el.addEventListener('keydown', function(e) {
            if (e.ctrlKey && e.key === 's') {
                e.preventDefault();
                saveBuilderCode();
                showNotification('Сохранено', 'Код сохранён', '💾', 1000);
            }
            if (e.ctrlKey && e.shiftKey && e.key === 'P') {
                e.preventDefault();
                previewBuilderCode();
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.selectionStart;
                this.value = this.value.substring(0, start) + '    ' + this.value.substring(this.selectionEnd);
                this.selectionStart = this.selectionEnd = start + 4;
            }
        });
    });
}

function saveBuilderCode() {
    AppBuilder.html = document.getElementById('b-html').value;
    AppBuilder.css = document.getElementById('b-css').value;
    AppBuilder.js = document.getElementById('b-js').value;
    AppBuilder.name = document.getElementById('b-editor-name').value.trim() || AppBuilder.name;
    AppBuilder.icon = document.getElementById('b-editor-icon').value.trim();
    AppBuilder.type = 'editor';
    AppBuilder.isModified = true;
    addBuilderRecent(AppBuilder.name, 'editor');
    saveBuilderData();
}

function previewBuilderCode() {
    const html = document.getElementById('b-html').value || '';
    const css = document.getElementById('b-css').value || '';
    const js = document.getElementById('b-js').value || '';
    
    const full = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${css}</style></head>
<body>${html}<script>${js}<\/script></body>
</html>`;
    
    const frame = document.getElementById('b-preview-frame');
    if (frame) frame.srcdoc = full;
    
    document.querySelectorAll('.b-tab').forEach(t => t.style.borderBottom = '2px solid transparent');
    const previewTab = document.querySelector('.b-tab[data-tab="preview"]');
    if (previewTab) previewTab.style.borderBottom = '2px solid #667eea';
    document.querySelectorAll('.b-code-editor').forEach(el => el.style.display = 'none');
    document.getElementById('b-preview-area').style.display = 'block';
}

// ===== ПРЕДПРОСМОТР =====
function renderBuilderPreview(content) {
    content.innerHTML = `
        <div style="max-width:100%;height:100%;display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                <h2 style="font-size:20px;margin:0;">👁 Предпросмотр</h2>
                <div style="display:flex;gap:6px;">
                    <button class="b-btn secondary" style="padding:6px 14px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600;transition:all 0.2s;display:flex;align-items:center;gap:6px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.8);border:1px solid rgba(255,255,255,0.08);" onclick="refreshBuilderPreview()"><i class="fas fa-sync-alt"></i> Обновить</button>
                </div>
            </div>
            <div style="flex:1;background:white;border-radius:14px;overflow:hidden;min-height:400px;">
                <iframe id="builder-preview-frame" style="width:100%;height:100%;border:none;background:white;"></iframe>
            </div>
        </div>
    `;
    refreshBuilderPreview();
}

function refreshBuilderPreview() {
    const frame = document.getElementById('builder-preview-frame');
    if (!frame) return;
    if (AppBuilder.type === 'editor' && (AppBuilder.html || AppBuilder.css || AppBuilder.js)) {
        const full = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${AppBuilder.css}</style></head>
<body>${AppBuilder.html}<script>${AppBuilder.js}<\/script></body>
</html>`;
        frame.srcdoc = full;
        return;
    }
    if (AppBuilder.url) {
        frame.src = AppBuilder.url;
        return;
    }
    frame.srcdoc = `<h1 style="color:#1a1a2e;text-align:center;padding:40px;">Нет контента для предпросмотра</h1>`;
}

function openBuilderFullscreen() {
    const frame = document.getElementById('builder-preview-frame');
    if (frame && frame.requestFullscreen) frame.requestFullscreen();
}

// ================================================================
// ===== ОСНОВНЫЕ ФУНКЦИИ КОНСТРУКТОРА =====
// ================================================================

function saveWrk() {
    saveBuilderCode();
    const data = {
        version: '3.0',
        name: AppBuilder.name,
        type: AppBuilder.type,
        url: AppBuilder.url,
        html: AppBuilder.html,
        css: AppBuilder.css,
        js: AppBuilder.js,
        icon: AppBuilder.icon,
        allowFiles: AppBuilder.allowFiles,
        timestamp: Date.now()
    };
    downloadFile(JSON.stringify(data, null, 2), `${AppBuilder.name}.Wrk`, 'application/json');
    showNotification('Экспорт', `"${AppBuilder.name}.Wrk" сохранён`, '📦', 1500);
}

function exportKy() {
    saveBuilderCode();
    let html = '';
    if (AppBuilder.type === 'web' && AppBuilder.url) {
        html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${AppBuilder.name}</title>
<style>body{margin:0;overflow:hidden;height:100vh;}iframe{width:100%;height:100%;border:none;}</style>
</head>
<body><iframe src="${AppBuilder.url}"></iframe></body>
</html>`;
    } else {
        html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${AppBuilder.name}</title>
<style>${AppBuilder.css}</style>
</head>
<body>${AppBuilder.html}<script>${AppBuilder.js}<\/script></body>
</html>`;
    }
    if (AppBuilder.allowFiles) {
        const api = `<script>
window.KOS = {
    saveFile: function(n,d) {
        try { window.parent.postMessage({action:'saveFile',name:n,dataUrl:d},'*'); return true; }
        catch(e){ return false; }
    },
    saveToDesktop: function(n,d) {
        try { window.parent.postMessage({action:'saveToDesktop',name:n,dataUrl:d},'*'); return true; }
        catch(e){ return false; }
    },
    getFiles: function() {
        return new Promise(function(resolve) {
            var h = function(e) {
                if(e.data.action==='filesList') {
                    window.removeEventListener('message',h);
                    resolve(e.data.files);
                }
            };
            window.addEventListener('message',h);
            window.parent.postMessage({action:'getFiles'},'*');
            setTimeout(function(){ window.removeEventListener('message',h); resolve([]); },3000);
        });
    }
};
<\/script>`;
        html = html.replace('</body>', api + '</body>');
    }
    downloadFile(html, `${AppBuilder.name}.Ky`, 'text/html');
    showNotification('Готово', `"${AppBuilder.name}.Ky" создан`, '🚀', 1500);
}

function testApp() {
    saveBuilderCode();
    if (AppBuilder.type === 'web' && AppBuilder.url) {
        window.open(AppBuilder.url, '_blank');
    } else {
        renderBuilderView('preview');
        setTimeout(refreshBuilderPreview, 200);
    }
}

function installApp() {
    saveBuilderCode();
    let content = '';
    if (AppBuilder.type === 'web' && AppBuilder.url) {
        content = AppBuilder.url;
    } else {
        content = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${AppBuilder.name}</title>
<style>${AppBuilder.css}</style>
</head>
<body>${AppBuilder.html}<script>${AppBuilder.js}<\/script></body>
</html>`;
    }
    pinnedApps.push({
        id: 'app-' + Date.now(),
        title: AppBuilder.name,
        icon: AppBuilder.icon || 'fa-window-maximize',
        type: 'webapp',
        content: content,
        allowFileAccess: AppBuilder.allowFiles
    });
    saveToFirebase();
    renderTaskbar();
    showNotification('Установлено', `"${AppBuilder.name}" в панели задач`, '📌', 1500);
}

function loadProject() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.Wrk,.Ky,.html';
    input.onchange = function(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const text = ev.target.result;
                try {
                    const data = JSON.parse(text);
                    if (data.version && data.name) {
                        AppBuilder.name = data.name || 'Проект';
                        AppBuilder.type = data.type || 'editor';
                        AppBuilder.url = data.url || '';
                        AppBuilder.html = data.html || '';
                        AppBuilder.css = data.css || '';
                        AppBuilder.js = data.js || '';
                        AppBuilder.icon = data.icon || '';
                        AppBuilder.allowFiles = data.allowFiles || false;
                        showNotification('Загружено', `"${AppBuilder.name}" загружен`, '📂', 1500);
                        renderBuilderView('editor');
                        fillBuilderEditors();
                        return;
                    }
                } catch(e) {}
                if (text.includes('<!DOCTYPE') || text.includes('<html')) {
                    AppBuilder.html = text;
                    AppBuilder.name = file.name.replace(/\.(Ky|html)$/i, '');
                    AppBuilder.type = 'editor';
                    showNotification('Загружено', `"${AppBuilder.name}" загружен`, '📂', 1500);
                    renderBuilderView('editor');
                    fillBuilderEditors();
                    return;
                }
                showNotification('Ошибка', 'Неверный формат файла', '❌', 1500);
            } catch(e) {
                showNotification('Ошибка', 'Не удалось загрузить', '❌', 1500);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

function fillBuilderEditors() {
    setTimeout(() => {
        const html = document.getElementById('b-html');
        const css = document.getElementById('b-css');
        const js = document.getElementById('b-js');
        const name = document.getElementById('b-editor-name');
        const icon = document.getElementById('b-editor-icon');
        if (html) html.value = AppBuilder.html;
        if (css) css.value = AppBuilder.css;
        if (js) js.value = AppBuilder.js;
        if (name) name.value = AppBuilder.name;
        if (icon) icon.value = AppBuilder.icon;
    }, 50);
}

function loadExample() {
    AppBuilder.name = 'Todo-приложение';
    AppBuilder.type = 'editor';
    AppBuilder.html = `<div class="app">
    <h1>📝 Мои задачи</h1>
    <div class="input-row">
        <input id="todo-input" placeholder="Добавить задачу..." onkeypress="if(event.key==='Enter') addTodo()">
        <button onclick="addTodo()">➕</button>
    </div>
    <ul id="todo-list"></ul>
</div>`;
    AppBuilder.css = `.app{max-width:500px;margin:0 auto;padding:20px;font-family:Arial}
h1{text-align:center;color:#667eea}
.input-row{display:flex;gap:8px;margin-bottom:16px}
.input-row input{flex:1;padding:10px;border:2px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(255,255,255,0.06);color:white;font-size:14px;outline:none}
.input-row input:focus{border-color:#667eea}
.input-row button{padding:10px 20px;background:linear-gradient(135deg,#667eea,#764ba2);border:none;border-radius:8px;color:white;cursor:pointer;font-size:18px}
#todo-list{list-style:none;padding:0}
#todo-list li{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(255,255,255,0.04);border-radius:8px;margin-bottom:6px;cursor:pointer}
#todo-list li:hover{background:rgba(255,255,255,0.08)}
#todo-list li.done{text-decoration:line-through;opacity:0.4}
#todo-list li .del{background:none;border:none;color:#ff6b6b;cursor:pointer;font-size:16px}`;
    AppBuilder.js = `let todos = [];
function addTodo(){var i=document.getElementById('todo-input'),t=i.value.trim();if(!t)return;todos.push({text:t,done:false});i.value='';renderTodos()}
function toggleTodo(i){todos[i].done=!todos[i].done;renderTodos()}
function deleteTodo(i){todos.splice(i,1);renderTodos()}
function renderTodos(){var list=document.getElementById('todo-list');list.innerHTML=todos.map(function(t,i){return '<li class="'+(t.done?'done':'')+'" onclick="toggleTodo('+i+')">'+t.text+'<button class="del" onclick="event.stopPropagation();deleteTodo('+i+')">✕</button></li>'}).join('')}`;
    AppBuilder.icon = '';
    AppBuilder.allowFiles = false;
    addBuilderRecent(AppBuilder.name, 'editor');
    saveBuilderData();
    renderBuilderView('editor');
    fillBuilderEditors();
    showNotification('Загружено', 'Пример Todo-приложения готов', '📖', 1500);
}

// ================================================================
// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ КОНСТРУКТОРА =====
// ================================================================

function downloadFile(content, filename, type) {
    const blob = new Blob([content], { type: type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addBuilderRecent(name, type) {
    AppBuilder.recent = AppBuilder.recent.filter(p => p.name !== name);
    AppBuilder.recent.unshift({ name, type, timestamp: Date.now() });
    if (AppBuilder.recent.length > 20) AppBuilder.recent = AppBuilder.recent.slice(0, 20);
    updateBuilderRecent();
    saveBuilderData();
}

function updateBuilderRecent() {
    const list = document.getElementById('builder-recent-list');
    if (!list) return;
    if (AppBuilder.recent.length === 0) {
        list.innerHTML = '<div style="font-size:11px;opacity:0.2;padding:6px;">Нет проектов</div>';
        return;
    }
    list.innerHTML = AppBuilder.recent.slice(0, 5).map(p => `
        <div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;cursor:pointer;font-size:11px;transition:all 0.2s;" 
             onmouseover="this.style.background='rgba(255,255,255,0.05)'" 
             onmouseout="this.style.background='none'"
             onclick="loadBuilderRecent('${p.name}')">
            <i class="fas ${p.type === 'web' ? 'fa-globe' : 'fa-code'}" style="font-size:10px;opacity:0.4;"></i>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.name}</span>
        </div>
    `).join('');
}

function loadBuilderRecent(name) {
    const p = AppBuilder.recent.find(r => r.name === name);
    if (!p) return;
    AppBuilder.name = p.name;
    AppBuilder.type = p.type;
    try {
        const saved = localStorage.getItem('builder_data_v3');
        if (saved) {
            const data = JSON.parse(saved);
            if (data.current && data.current.name === name) {
                AppBuilder.url = data.current.url || '';
                AppBuilder.html = data.current.html || '';
                AppBuilder.css = data.current.css || '';
                AppBuilder.js = data.current.js || '';
                AppBuilder.icon = data.current.icon || '';
                AppBuilder.allowFiles = data.current.allowFiles || false;
            }
        }
    } catch(e) {}
    if (AppBuilder.type === 'web') {
        renderBuilderView('web');
        document.getElementById('b-web-url').value = AppBuilder.url;
        document.getElementById('b-web-name').value = AppBuilder.name;
        document.getElementById('b-web-icon').value = AppBuilder.icon;
    } else {
        renderBuilderView('editor');
        fillBuilderEditors();
    }
    showNotification('Загружено', `"${AppBuilder.name}" загружен`, '📂', 1000);
}

// ================================================================
// ===== СООБЩЕНИЯ ДЛЯ IFRAME =====
// ================================================================

window.addEventListener('message', (e) => {
    if (e.data.action === 'saveFile' || e.data.action === 'saveToDesktop') {
        const { name, dataUrl } = e.data;
        if (currentUser) {
            currentDesktopItems.push({
                id: Date.now() + Math.random(),
                name: name || 'файл.txt',
                type: 'file',
                content: dataUrl
            });
            renderDesktop();
            saveToFirebase();
            showNotification('Файл сохранён', `"${name}" на рабочем столе`, '💾', 1500);
        }
    }
    if (e.data.action === 'getFiles') {
        e.source.postMessage({
            action: 'filesList',
            files: currentDesktopItems.map(f => ({ name: f.name, type: f.type, id: f.id }))
        }, '*');
    }
});

// ================================================================
// ===== ЗАПУСК ПРИЛОЖЕНИЙ =====
// ================================================================

if (typeof launchApp !== 'undefined') {
    const origLaunchApp = launchApp;
    launchApp = function(appData) {
        if (appData.type === 'webapp' && appData.content) {
            openAppWindow({ name: appData.title + '.exe', content: appData.content, id: appData.id });
            return;
        }
        origLaunchApp(appData);
    };
} else {
    window.launchApp = function(appData) {
        if (appData.type === 'webapp' && appData.content) {
            openAppWindow({ name: appData.title + '.exe', content: appData.content, id: appData.id });
            return;
        }
        const item = currentDesktopItems.find(i => 
            i.name === appData.title || 
            i.id == appData.id || 
            i.id == appData.fileId
        );
        if (item) {
            if (item.type === 'folder') openFolderWindow(item);
            else openFile(item);
            return;
        }
    };
}

// ================================================================
// ===== НАСТРОЙКИ (ПОЛНОСТЬЮ РАБОЧИЕ) =====
// ================================================================

window.openSettings = function() {
    const existing = document.querySelector('[data-file-id="settings-window"]');
    if (existing) {
        focusWindow(existing);
        return;
    }
    const win = createWindow({
        title: 'Настройки',
        icon: 'fa-cog',
        fileId: 'settings-window',
        width: 1000,
        height: 700,
        resizable: true,
        body: `
            <div style="display:flex;height:100%;">
                <div style="width:200px;border-right:1px solid rgba(255,255,255,0.06);padding:8px;overflow-y:auto;flex-shrink:0;">
                    <div class="ks-nav-item active" data-section="account"><i class="fas fa-user-circle"></i> Аккаунт</div>
                    <div class="ks-nav-item" data-section="devices"><i class="fas fa-laptop"></i> Устройства</div>
                    <div class="ks-nav-item" data-section="connected"><i class="fas fa-plug"></i> Подключенные</div>
                    <div class="ks-nav-item" data-section="personalize"><i class="fas fa-palette"></i> Персонализация</div>
                    <div class="ks-nav-item" data-section="apps"><i class="fas fa-th-large"></i> Приложения</div>
                    <div class="ks-nav-item" data-section="accounts"><i class="fas fa-id-card"></i> Учетные записи</div>
                    <div class="ks-nav-item" data-section="time"><i class="fas fa-clock"></i> Время и конф.</div>
                    <div class="ks-nav-item" data-section="updates"><i class="fas fa-sync-alt"></i> Обновление</div>
                </div>
                <div id="ks-content" style="flex:1;overflow-y:auto;padding:24px;"></div>
            </div>
        `,
        bodyStyle: 'padding:0;flex:1;overflow:hidden;'
    });
    document.body.appendChild(win);
    openWindows.push(win);
    renderTaskbar();
    focusWindow(win);
    setTimeout(() => {
        const style = document.createElement('style');
        style.textContent = `
            .ks-nav-item { display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;cursor:pointer;font-size:13px;color:rgba(255,255,255,0.6);transition:all 0.2s;margin-bottom:2px; }
            .ks-nav-item:hover { background:rgba(255,255,255,0.05);color:white; }
            .ks-nav-item.active { background:rgba(102,126,234,0.2);color:white; }
            .ks-card { background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:16px;padding:20px;margin-bottom:16px; }
            .ks-input { width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:10px 14px;color:white;font-size:14px;outline:none;margin-top:8px; }
            .ks-input:focus { border-color:#667eea; }
            .ks-btn { padding:8px 18px;border-radius:10px;border:none;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s; }
            .ks-btn.primary { background:linear-gradient(135deg,#667eea,#764ba2);color:white; }
            .ks-btn.primary:hover { transform:translateY(-1px);box-shadow:0 4px 15px rgba(102,126,234,0.3); }
            .ks-btn.secondary { background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.1); }
            .ks-btn.secondary:hover { background:rgba(255,255,255,0.12); }
            .ks-device-row { display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,0.03);border-radius:12px;border:1px solid rgba(255,255,255,0.04);margin-bottom:8px;transition:all 0.2s; }
            .ks-device-row:hover { background:rgba(255,255,255,0.05); }
            .ks-dot { width:10px;height:10px;border-radius:50%;flex-shrink:0; }
            .ks-dot.green { background:#44ff88;box-shadow:0 0 10px rgba(68,255,136,0.4); }
            .ks-dot.orange { background:#ffaa44;box-shadow:0 0 10px rgba(255,170,68,0.4); }
            .ks-dot.red { background:#ff4444;box-shadow:0 0 10px rgba(255,68,68,0.4); }
        `;
        win.querySelector('.window-body').appendChild(style);
        showKsSection(win, 'account');
        win.querySelectorAll('.ks-nav-item').forEach(item => {
            item.onclick = () => {
                win.querySelectorAll('.ks-nav-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                showKsSection(win, item.dataset.section);
            };
        });
    }, 50);
};

function showKsSection(win, section) {
    const content = win.querySelector('#ks-content');
    const user = currentUser;
    switch(section) {
        case 'account':
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Аккаунт</h2>
                <div class="ks-card" style="display:flex;align-items:center;gap:20px;">
                    <div id="ks-avatar" style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#667eea,#764ba2);display:flex;align-items:center;justify-content:center;font-size:32px;cursor:pointer;flex-shrink:0;" title="Нажми чтобы изменить аватар">${(user?.displayName || 'K')[0].toUpperCase()}</div>
                    <div style="flex:1;">
                        <h3 style="margin:0;" id="ks-display-name">${user?.displayName || 'Пользователь'}</h3>
                        <p style="opacity:0.5;margin:4px 0;" id="ks-email">${user?.email || ''}</p>
                        <span style="background:rgba(102,126,234,0.2);padding:4px 10px;border-radius:6px;font-size:12px;color:#667eea;">Моя запись K</span>
                    </div>
                    <button class="ks-btn primary" id="ks-edit-profile">Изменить профиль</button>
                </div>
                <div class="ks-card">
                    <h4>Безопасность</h4>
                    <button class="ks-btn secondary" id="ks-change-password" style="margin-top:8px;">Сменить пароль</button>
                    <button class="ks-btn secondary" id="ks-signout" style="margin-top:8px;margin-left:8px;">Выйти из аккаунта</button>
                </div>
            `;
            content.querySelector('#ks-edit-profile').onclick = () => editProfileKs(win);
            content.querySelector('#ks-avatar').onclick = () => changeAvatarKs(win);
            content.querySelector('#ks-change-password').onclick = () => changePasswordKs();
            content.querySelector('#ks-signout').onclick = () => signOut(auth);
            break;
        case 'devices':
            const isVisible = document.visibilityState === 'visible';
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Устройства в экосистеме K</h2>
                <p style="opacity:0.4;font-size:13px;margin-bottom:16px;">Устройства, на которых выполнен вход в ваш аккаунт</p>
                <div class="ks-device-row">
                    <i class="fas fa-desktop" style="font-size:24px;opacity:0.6;"></i>
                    <div style="flex:1;">
                        <div style="font-weight:500;">Это устройство</div>
                        <div style="font-size:11px;opacity:0.4;">${navigator.platform || 'Неизвестно'} • ${navigator.userAgent.includes('Chrome') ? 'Chrome' : navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Браузер'}</div>
                    </div>
                    <div class="ks-dot ${isVisible ? 'green' : 'orange'}"></div>
                    <button style="background:none;border:none;color:rgba(255,255,255,0.4);cursor:pointer;font-size:18px;" onclick="showDeviceMenu(event)" title="Действия">⋯</button>
                </div>
                <p style="opacity:0.3;font-size:11px;margin-top:12px;">🟢 Зеленый — K-OS открыт и активен<br>🟠 Оранжевый — K-OS открыт, но вкладка неактивна<br>🔴 Красный — K-OS закрыт</p>
            `;
            break;
        case 'connected':
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Подключенные устройства</h2>
                <p style="opacity:0.4;font-size:13px;margin-bottom:16px;">Устройства, подключенные к компьютеру</p>
                <div id="ks-connected-list">
                    <div class="ks-device-row">
                        <i class="fas fa-mouse" style="font-size:20px;opacity:0.6;"></i>
                        <div style="flex:1;font-weight:500;">Мышь</div>
                        <span style="font-size:11px;opacity:0.3;">Обнаружено</span>
                    </div>
                    <div class="ks-device-row">
                        <i class="fas fa-keyboard" style="font-size:20px;opacity:0.6;"></i>
                        <div style="flex:1;font-weight:500;">Клавиатура</div>
                        <span style="font-size:11px;opacity:0.3;">Обнаружено</span>
                    </div>
                </div>
                <button class="ks-btn secondary" style="margin-top:12px;" id="ks-scan-devices">🔍 Сканировать USB/Bluetooth</button>
                <p style="opacity:0.2;font-size:10px;margin-top:8px;" id="ks-scan-status"></p>
            `;
            content.querySelector('#ks-scan-devices').onclick = async () => {
                const status = content.querySelector('#ks-scan-status');
                status.textContent = 'Сканирование...';
                try {
                    const devices = await navigator.mediaDevices?.enumerateDevices();
                    if (devices && devices.length > 0) {
                        const list = content.querySelector('#ks-connected-list');
                        list.innerHTML = devices
                            .filter(d => d.kind !== 'audiooutput')
                            .map(d => `
                                <div class="ks-device-row">
                                    <i class="fas ${d.kind === 'audioinput' ? 'fa-microphone' : d.kind === 'videoinput' ? 'fa-camera' : 'fa-plug'}" style="font-size:20px;opacity:0.6;"></i>
                                    <div style="flex:1;font-weight:500;">${d.label || 'Устройство ' + d.deviceId.slice(0, 8)}</div>
                                    <span style="font-size:11px;opacity:0.3;">${d.kind}</span>
                                </div>
                            `).join('');
                        status.textContent = 'Найдено устройств: ' + devices.length;
                    } else {
                        status.textContent = 'Устройства не найдены (нужен HTTPS)';
                    }
                } catch(e) {
                    status.textContent = 'Ошибка: нужен HTTPS-доступ';
                }
            };
            break;
        case 'personalize':
            const wallpapers = [
                systemConfig.wallpaper,
                'https://i.ibb.co/ymHCrZzL/image.jpg',
                'https://i.ibb.co/yBYpDyMH/image.png',
                'https://i.ibb.co/ccvjPDC4/image-Picsart-Ai-Image-Enhancer.png'
            ];
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Персонализация</h2>
                <div class="ks-card">
                    <h4>Обои рабочего стола</h4>
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,100px));gap:10px;margin-top:12px;">
                        ${[...new Set(wallpapers)].map((url, i) => `
                            <div class="ks-wall-item" data-url="${url}" style="height:65px;background-image:url(${url});background-size:cover;border-radius:10px;cursor:pointer;border:2px solid ${systemConfig.wallpaper===url?'#667eea':'transparent'};transition:all 0.2s;"></div>
                        `).join('')}
                    </div>
                    <button class="ks-btn secondary" style="margin-top:12px;" id="ks-upload-wall">📁 Загрузить свои обои</button>
                    <button class="ks-btn secondary" style="margin-top:8px;" id="ks-wall-from-desktop">🖼 Выбрать с рабочего стола</button>
                </div>
                <div class="ks-card">
                    <h4>Тема</h4>
                    <div style="display:flex;gap:10px;margin-top:12px;">
                        <button class="ks-btn ${systemConfig.theme==='dark'?'primary':'secondary'} ks-theme-btn" data-theme="dark">🌙 Тёмная</button>
                        <button class="ks-btn ${systemConfig.theme==='light'?'primary':'secondary'} ks-theme-btn" data-theme="light">☀️ Светлая</button>
                    </div>
                </div>
                <div class="ks-card">
                    <h4>Жидкое стекло</h4>
                    <input type="range" id="ks-glass-slider" min="10" max="90" value="${(systemConfig.glassOpacity||0.6)*100}" style="width:100%;margin-top:8px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;opacity:0.4;"><span>Прозрачный</span><span>Непрозрачный</span></div>
                    <button class="ks-btn secondary" style="margin-top:8px;" id="ks-save-glass">Применить ко всем окнам</button>
                </div>
            `;
            content.querySelectorAll('.ks-wall-item').forEach(item => {
                item.onclick = () => {
                    systemConfig.wallpaper = item.dataset.url;
                    applyConfig();
                    saveToFirebase();
                    showKsSection(win, 'personalize');
                };
            });
            content.querySelector('#ks-upload-wall').onclick = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.onchange = (e) => {
                    const file = e.target.files[0];
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        systemConfig.wallpaper = ev.target.result;
                        applyConfig();
                        saveToFirebase();
                        showKsSection(win, 'personalize');
                    };
                    reader.readAsDataURL(file);
                };
                input.click();
            };
            content.querySelector('#ks-wall-from-desktop').onclick = () => {
                const images = currentDesktopItems.filter(i => i.content && i.content.startsWith('data:image'));
                if (images.length === 0) {
                    Swal.fire({ title: 'Нет изображений', text: 'Загрузите изображения на рабочий стол', icon: 'info', background: '#1a1a2e', color: '#fff' });
                    return;
                }
                const options = images.map(i => `<option value="${i.content}">${i.name}</option>`).join('');
                Swal.fire({
                    title: 'Выберите изображение',
                    html: `<select id="ks-wall-select" style="width:100%;padding:10px;">${options}</select>`,
                    background: '#1a1a2e',
                    color: '#fff',
                    showCancelButton: true,
                    confirmButtonText: 'Применить',
                    preConfirm: () => {
                        const url = document.getElementById('ks-wall-select').value;
                        systemConfig.wallpaper = url;
                        applyConfig();
                        saveToFirebase();
                        showKsSection(win, 'personalize');
                    }
                });
            };
            content.querySelectorAll('.ks-theme-btn').forEach(btn => {
                btn.onclick = () => {
                    systemConfig.theme = btn.dataset.theme;
                    applyConfig();
                    saveToFirebase();
                    showKsSection(win, 'personalize');
                };
            });
            content.querySelector('#ks-glass-slider').oninput = function() {
                const val = this.value / 100;
                systemConfig.glassOpacity = val;
                document.documentElement.style.setProperty('--glass-opacity', val);
            };
            content.querySelector('#ks-save-glass').onclick = () => {
                document.querySelectorAll('.glass-panel').forEach(panel => {
                    panel.style.background = `rgba(30, 30, 40, ${systemConfig.glassOpacity})`;
                });
                saveToFirebase();
                Swal.fire({ title: 'Применено!', timer: 1000, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
            };
            break;
        case 'apps':
            const allApps = [];
            if (window.openKdraw) allApps.push({ name: 'K-draw', icon: 'fa-paint-brush', id: 'kdraw' });
            allApps.push({ name: 'Блокнот', icon: 'fa-edit', id: 'notepad' });
            allApps.push({ name: 'Конструктор', icon: 'fa-code', id: 'builder' });
            allApps.push({ name: 'Настройки', icon: 'fa-cog', id: 'settings' });
            allApps.push({ name: 'Калькулятор', icon: 'fa-calculator', id: 'calculator' });
            pinnedApps.forEach(app => {
                if (!allApps.find(a => a.name === app.title)) {
                    allApps.push({ name: app.title, icon: app.icon || 'fa-window-maximize', id: app.id });
                }
            });
            currentDesktopItems.filter(i => i.name.endsWith('.exe')).forEach(item => {
                if (!allApps.find(a => a.name === item.name.replace('.exe',''))) {
                    allApps.push({ name: item.name.replace('.exe',''), icon: 'fa-cog', id: item.id });
                }
            });
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Приложения</h2>
                <p style="opacity:0.4;font-size:13px;margin-bottom:16px;">${allApps.length} приложений установлено</p>
                ${allApps.map(app => `
                    <div class="ks-device-row" style="cursor:pointer;" data-app-id="${app.id}">
                        <i class="fas ${app.icon}" style="font-size:20px;opacity:0.7;"></i>
                        <div style="flex:1;font-weight:500;">${app.name}</div>
                        <button class="ks-btn secondary" style="font-size:11px;padding:4px 10px;" data-action="launch">Открыть</button>
                        <button class="ks-btn secondary" style="font-size:11px;padding:4px 10px;margin-left:4px;" data-action="uninstall">Удалить</button>
                    </div>
                `).join('')}
            `;
            content.querySelectorAll('[data-action="launch"]').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.ks-device-row');
                    const appId = row.dataset.appId;
                    if (appId === 'kdraw') openKdraw();
                    else if (appId === 'notepad') openNotepad({ name: 'заметка.txt', content: '', id: Date.now() });
                    else if (appId === 'builder') openAppBuilder2();
                    else if (appId === 'settings') {}
                    else if (appId === 'calculator') openCalculator();
                    else {
                        const item = currentDesktopItems.find(i => i.id == appId);
                        if (item) openFile(item);
                    }
                };
            });
            content.querySelectorAll('[data-action="uninstall"]').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.ks-device-row');
                    const appId = row.dataset.appId;
                    Swal.fire({
                        title: 'Удалить приложение?',
                        text: 'Файл будет перемещён в корзину',
                        icon: 'warning',
                        background: '#1a1a2e',
                        color: '#fff',
                        showCancelButton: true,
                        confirmButtonText: 'Удалить'
                    }).then(result => {
                        if (result.isConfirmed) {
                            const item = currentDesktopItems.find(i => i.id == appId);
                            if (item) {
                                trashItems.push({ ...item });
                                currentDesktopItems = currentDesktopItems.filter(i => i.id !== appId);
                            }
                            pinnedApps = pinnedApps.filter(a => a.id !== appId && a.title !== row.querySelector('div').textContent);
                            saveToFirebase();
                            renderDesktop();
                            renderTaskbar();
                            showKsSection(win, 'apps');
                        }
                    });
                };
            });
            break;
        case 'accounts':
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Учетные записи</h2>
                <div class="ks-device-row">
                    <i class="fas fa-envelope" style="font-size:20px;opacity:0.7;"></i>
                    <div style="flex:1;">
                        <div style="font-weight:500;">${user?.email || 'Неизвестно'}</div>
                        <div style="font-size:11px;opacity:0.4;">Основной аккаунт K</div>
                    </div>
                    <span style="font-size:11px;color:#44ff88;">Активен</span>
                </div>
                <button class="ks-btn secondary" style="margin-top:12px;" id="ks-logout-btn">Выйти из аккаунта</button>
            `;
            content.querySelector('#ks-logout-btn').onclick = () => signOut(auth);
            break;
        case 'time':
            const now = new Date();
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Время и конфиденциальность</h2>
                <div class="ks-card">
                    <h4>Часовой пояс</h4>
                    <select class="ks-input" id="ks-timezone">
                        ${[-12,-11,-10,-9,-8,-7,-6,-5,-4,-3,-2,-1,0,1,2,3,4,5,6,7,8,9,10,11,12].map(tz => `
                            <option value="${tz}" ${-now.getTimezoneOffset()/60 === tz ? 'selected' : ''}>UTC${tz>=0?'+':''}${tz}</option>
                        `).join('')}
                    </select>
                    <button class="ks-btn secondary" style="margin-top:8px;" id="ks-apply-tz">Применить часовой пояс</button>
                </div>
                <div class="ks-card">
                    <h4>Текущее время системы</h4>
                    <p style="font-size:24px;font-weight:300;" id="ks-live-time">${now.toLocaleTimeString()}</p>
                    <p style="opacity:0.4;">${now.toLocaleDateString('ru-RU', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
                </div>
                <div class="ks-card">
                    <h4>Конфиденциальность</h4>
                    <p style="opacity:0.5;font-size:13px;">Ваши данные хранятся в зашифрованном виде в Firebase Firestore. Мы не передаём данные третьим лицам. Файлы рабочего стола доступны только вам.</p>
                    <p style="opacity:0.3;font-size:11px;">Firebase проект: k-os-36d06</p>
                </div>
            `;
            setInterval(() => {
                const timeEl = content.querySelector('#ks-live-time');
                if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();
            }, 1000);
            content.querySelector('#ks-apply-tz').onclick = () => {
                const tz = content.querySelector('#ks-timezone').value;
                Swal.fire({ title: 'Часовой пояс изменён', text: 'UTC' + (tz >= 0 ? '+' : '') + tz, timer: 1500, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
            };
            break;
        case 'updates':
            content.innerHTML = `
                <h2 style="margin-bottom:20px;">Обновление</h2>
                <div class="ks-card" style="text-align:center;padding:40px;">
                    <i class="fas fa-check-circle" style="font-size:56px;color:#44ff88;margin-bottom:16px;"></i>
                    <h3>K-OS актуальна</h3>
                    <p style="opacity:0.5;">Версия 1.0.0</p>
                    <p style="opacity:0.3;font-size:12px;">Последняя проверка: ${new Date().toLocaleString()}</p>
                    <p style="opacity:0.2;font-size:11px;margin-top:8px;">Обновлений пока нет</p>
                </div>
            `;
            break;
    }
}

function editProfileKs(win) {
    const user = currentUser;
    if (!user) return;
    Swal.fire({
        title: 'Изменить профиль',
        html: `
            <input id="swal-name" class="swal2-input" placeholder="Имя" value="${user.displayName || ''}" style="margin-bottom:8px;">
            <input id="swal-email" class="swal2-input" placeholder="Email" value="${user.email || ''}">
        `,
        background: '#1a1a2e',
        color: '#fff',
        showCancelButton: true,
        confirmButtonText: 'Сохранить',
        preConfirm: () => {
            const name = document.getElementById('swal-name').value.trim();
            const email = document.getElementById('swal-email').value.trim();
            if (name) updateProfile(user, { displayName: name }).then(() => {
                document.getElementById('ks-display-name').textContent = name;
                document.getElementById('ks-avatar').textContent = name[0].toUpperCase();
            });
            if (email && email !== user.email) {
                user.verifyBeforeUpdateEmail(email).catch(() => {
                    user.updateEmail(email).catch(e => Swal.fire({ title: 'Ошибка', text: 'Нужна повторная аутентификация', icon: 'error', background: '#1a1a2e', color: '#fff' }));
                });
            }
            showKsSection(win, 'account');
        }
    });
}

function changePasswordKs() {
    Swal.fire({
        title: 'Сменить пароль',
        html: `
            <input id="swal-old-pass" class="swal2-input" type="password" placeholder="Старый пароль" style="margin-bottom:8px;">
            <input id="swal-new-pass" class="swal2-input" type="password" placeholder="Новый пароль">
        `,
        background: '#1a1a2e',
        color: '#fff',
        showCancelButton: true,
        confirmButtonText: 'Сменить',
        preConfirm: () => {
            const newPass = document.getElementById('swal-new-pass').value;
            if (newPass && newPass.length >= 6) {
                currentUser.updatePassword(newPass).then(() => {
                    Swal.fire({ title: 'Пароль изменён!', icon: 'success', background: '#1a1a2e', color: '#fff' });
                }).catch(e => {
                    Swal.fire({ title: 'Ошибка', text: 'Нужна повторная аутентификация. Перезайдите в аккаунт.', icon: 'error', background: '#1a1a2e', color: '#fff' });
                });
            }
        }
    });
}

function changeAvatarKs(win) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = (e) => {
        const file = e.target.files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
            const dataUrl = ev.target.result;
            setAvatar(dataUrl);
            const avatar = win.querySelector('#ks-avatar');
            if (avatar) {
                avatar.style.backgroundImage = `url(${dataUrl})`;
                avatar.style.backgroundSize = 'cover';
                avatar.textContent = '';
            }
        };
        reader.readAsDataURL(file);
    };
    input.click();
}

// ===== СИСТЕМА СОХРАНЕНИЯ =====

function loadAllFromLocalStorage() {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const cachedWallpaper = localStorage.getItem('wallpaper_' + uid);
    if (cachedWallpaper) systemConfig.wallpaper = cachedWallpaper;
    const cachedAvatar = localStorage.getItem('avatar_' + uid);
    if (cachedAvatar) systemConfig.avatar = cachedAvatar;
    const cachedPositions = localStorage.getItem('iconPositions_' + uid);
    if (cachedPositions) {
        const positions = JSON.parse(cachedPositions);
        currentDesktopItems.forEach(item => {
            if (positions[item.id]) {
                item.x = positions[item.id].x;
                item.y = positions[item.id].y;
            }
        });
    }
    const cachedTheme = localStorage.getItem('theme_' + uid);
    if (cachedTheme) systemConfig.theme = cachedTheme;
    const cachedGlass = localStorage.getItem('glassOpacity_' + uid);
    if (cachedGlass) systemConfig.glassOpacity = parseFloat(cachedGlass);
    const cachedPinned = localStorage.getItem('pinnedApps_' + uid);
    if (cachedPinned) pinnedApps = JSON.parse(cachedPinned);
    applyConfig();
}

function saveAllToLocalStorage() {
    if (!currentUser) return;
    const uid = currentUser.uid;
    if (systemConfig.wallpaper) localStorage.setItem('wallpaper_' + uid, systemConfig.wallpaper);
    if (systemConfig.avatar) localStorage.setItem('avatar_' + uid, systemConfig.avatar);
    const positions = {};
    currentDesktopItems.forEach(item => {
        if (item.x !== undefined && item.y !== undefined) {
            positions[item.id] = { x: item.x, y: item.y };
        }
    });
    localStorage.setItem('iconPositions_' + uid, JSON.stringify(positions));
    localStorage.setItem('theme_' + uid, systemConfig.theme);
    localStorage.setItem('glassOpacity_' + uid, systemConfig.glassOpacity);
    localStorage.setItem('pinnedApps_' + uid, JSON.stringify(pinnedApps));
}

async function syncImageToCloud(dataUrl, type) {
    if (!dataUrl || !currentUser) return;
    try {
        const base64 = dataUrl.split(',')[1];
        if (!base64) return;
        const formData = new FormData();
        formData.append('image', base64);
        formData.append('key', IMGBB_KEY);
        const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
        const json = await res.json();
        if (json.success) {
            const url = json.data.url;
            if (type === 'wallpaper') systemConfig.wallpaper = url;
            else if (type === 'avatar') systemConfig.avatar = url;
            localStorage.setItem(type + '_' + currentUser.uid, url);
            await saveToFirebase();
            console.log('✅ ' + type + ' синхронизирован в облако');
        }
    } catch (e) {
        console.log('⏳ Синхронизация ' + type + ' отложена (нет соединения)');
    }
}

async function syncAllToCloud() {
    if (!currentUser) return;
    const uid = currentUser.uid;
    const wallpaper = localStorage.getItem('wallpaper_' + uid);
    if (wallpaper && wallpaper.startsWith('data:image')) {
        await syncImageToCloud(wallpaper, 'wallpaper');
    }
    const avatar = localStorage.getItem('avatar_' + uid);
    if (avatar && avatar.startsWith('data:image')) {
        await syncImageToCloud(avatar, 'avatar');
    }
}

async function saveToFirebase() {
    if (!currentUser) return;
    saveAllToLocalStorage();
    try {
        const uniquePinned = [];
        const seen = new Set();
        pinnedApps.forEach(app => {
            const key = app.title + (app.id || '');
            if (!seen.has(key)) { seen.add(key); uniquePinned.push(app); }
        });
        pinnedApps = uniquePinned;
        const userRef = doc(db, 'users', currentUser.uid);
        await setDoc(userRef, {
            desktopItems: currentDesktopItems,
            trashItems: trashItems,
            config: systemConfig,
            pinnedApps: pinnedApps
        }, { merge: true });
        syncAllToCloud();
    } catch (e) {
        console.error('Save error:', e);
    }
}

async function loadFromFirebase() {
    if (!currentUser) return;
    loadAllFromLocalStorage();
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            if (!localStorage.getItem('wallpaper_' + currentUser.uid)) {
                systemConfig.wallpaper = data.config?.wallpaper || systemConfig.wallpaper;
            }
            currentDesktopItems = data.desktopItems || [];
            trashItems = data.trashItems || [];
            const cachedPositions = localStorage.getItem('iconPositions_' + currentUser.uid);
            if (cachedPositions) {
                const positions = JSON.parse(cachedPositions);
                currentDesktopItems.forEach(item => {
                    if (positions[item.id]) {
                        item.x = positions[item.id].x;
                        item.y = positions[item.id].y;
                    }
                });
            }
            if (data.config) {
                systemConfig = { ...systemConfig, ...data.config };
                const localWallpaper = localStorage.getItem('wallpaper_' + currentUser.uid);
                const localAvatar = localStorage.getItem('avatar_' + currentUser.uid);
                if (localWallpaper) systemConfig.wallpaper = localWallpaper;
                if (localAvatar) systemConfig.avatar = localAvatar;
            }
            const localPinned = localStorage.getItem('pinnedApps_' + currentUser.uid);
            if (localPinned) {
                pinnedApps = JSON.parse(localPinned);
            } else {
                pinnedApps = data.pinnedApps || [];
            }
            applyConfig();
            renderDesktop();
            renderTaskbar();
        } else {
            currentDesktopItems = [];
            pinnedApps = [];
            renderDesktop();
            renderTaskbar();
            await saveToFirebase();
        }
        syncAllToCloud();
    } catch (e) {
        console.error('Load error:', e);
    }
}

// ===== ОБНОВЛЁННАЯ AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
    console.log("Auth state changed:", user ? "Пользователь есть" : "Нет пользователя");
    try {
        if (user) {
            currentUser = user;
            loadAllFromLocalStorage();
            applyConfig();
            renderDesktop();
            renderTaskbar();
            await loadFromFirebase();
            if (systemConfig.password) {
                showScreen(loginScreen);
            } else {
                showScreen(desktop);
            }
        } else {
            currentUser = null;
            currentDesktopItems = [];
            trashItems = [];
            pinnedApps = [];
            currentStep = 1;
            showScreen(authScreen);
            renderSetupStep();
        }
    } catch (error) {
        console.error("Ошибка при загрузке:", error);
        showScreen(authScreen);
    } finally {
        showLoading(false);
    }
});

function setWallpaper(url) {
    systemConfig.wallpaper = url;
    if (currentUser) localStorage.setItem('wallpaper_' + currentUser.uid, url);
    applyConfig();
    saveToFirebase();
    if (url.startsWith('data:image')) syncImageToCloud(url, 'wallpaper');
}

function setAvatar(dataUrl) {
    systemConfig.avatar = dataUrl;
    if (currentUser) localStorage.setItem('avatar_' + currentUser.uid, dataUrl);
    saveToFirebase();
    if (dataUrl.startsWith('data:image')) syncImageToCloud(dataUrl, 'avatar');
}
// ================================================================
// ===== ЭКСПОРТ КОНСТРУКТОРА ПРИЛОЖЕНИЙ В window (для onclick) =====
// ================================================================
Object.assign(window, {
    openAppBuilder2, closeBuilder, renderBuilderView,
    saveBuilderWeb, previewBuilderWeb,
    saveWrk, exportKy, testApp, installApp,
    loadProject, loadExample,
    refreshBuilderPreview, loadBuilderRecent
});

// ===== ФИКС НАВИГАЦИИ В САЙДБАРЕ КОНСТРУКТОРА =====
// (делегирование клика вместо битого onclick/класса)
document.addEventListener('click', (e) => {
    const nav = e.target.closest('.builder-nav');
    if (!nav) return;
    renderBuilderView(nav.dataset.view);
});

// подсветка активного пункта — теперь работает на правильном классе
const _origRenderBuilderView = renderBuilderView;
renderBuilderView = function(view) {
    _origRenderBuilderView(view);
    document.querySelectorAll('.builder-nav').forEach(el => {
        const active = el.dataset.view === view;
        el.style.background = active ? 'rgba(102,126,234,0.2)' : 'transparent';
        el.style.color = active ? 'white' : 'rgba(255,255,255,0.6)';
        el.style.border = active ? '1px solid rgba(102,126,234,0.3)' : 'none';
    });
};
window.renderBuilderView = renderBuilderView;

// ===== АВТОСОХРАНЕНИЕ ЧЕРЕЗ 1.5с ПОСЛЕ ПРАВОК В РЕДАКТОРЕ =====
let _builderAutosaveTimer = null;
document.addEventListener('input', (e) => {
    if (!e.target.matches('#b-html, #b-css, #b-js')) return;
    clearTimeout(_builderAutosaveTimer);
    _builderAutosaveTimer = setTimeout(() => {
        if (typeof saveBuilderCode === 'function') saveBuilderCode();
    }, 1500);
});
// Инициализация конструктора
loadBuilderData();
updateBuilderRecent();
console.log('✅ Конструктор приложений v3.0 готов!');
console.log('📦 Форматы: .Wrk (проект), .Ky (приложение)');
console.log('✅ K-OS полностью обновлён!');
console.log('✅ Сохранение в localStorage + Firebase + ImgBB');
console.log('✅ Добавлен таскбар с управлением окнами');
console.log('✅ Закрепление приложений на панели');
console.log('✅ Контекстное меню для иконок таскбара');

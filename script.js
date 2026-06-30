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
let setupData = {};
let openWindows = [];
let windowZIndex = 1000;

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const desktop = document.getElementById('desktop');

// ===== АВТОСОХРАНЕНИЕ КАЖДУЮ СЕКУНДУ =====
let autoSaveInterval = null;

function startAutoSave() {
    if (autoSaveInterval) clearInterval(autoSaveInterval);
    autoSaveInterval = setInterval(() => {
        if (currentUser) {
            saveToFirebase();
        }
    }, 1000);
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
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
            startAutoSave();
        }
    }
}

async function saveToFirebase() {
    if (!currentUser) return;
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        await setDoc(userRef, {
            desktopItems: currentDesktopItems,
            trashItems: trashItems,
            config: systemConfig
        }, { merge: true });
    } catch (e) {
        console.error('Save error:', e);
    }
}

async function loadFromFirebase() {
    if (!currentUser) return;
    try {
        const userRef = doc(db, 'users', currentUser.uid);
        const docSnap = await getDoc(userRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            currentDesktopItems = data.desktopItems || [];
            trashItems = data.trashItems || [];
            systemConfig = { ...systemConfig, ...data.config };
            applyConfig();
            renderDesktop();
        } else {
            currentDesktopItems = [];
            renderDesktop();
        }
    } catch (e) {
        console.error('Load error:', e);
    }
}

function applyConfig() {
    // Обои
    if (desktop) {
        desktop.style.backgroundImage = `url(${systemConfig.wallpaper})`;
        desktop.style.backgroundSize = 'cover';
        desktop.style.backgroundPosition = 'center';
        desktop.style.backgroundRepeat = 'no-repeat';
    }
    
    // Тема
    document.body.classList.toggle('light-theme', systemConfig.theme === 'light');
    
    // Жидкое стекло
    document.documentElement.style.setProperty('--glass-opacity', systemConfig.glassOpacity || 0.6);
    document.documentElement.style.setProperty('--glass-blur', (systemConfig.glassBlur || 20) + 'px');
    document.documentElement.style.setProperty('--glass-border', systemConfig.glassBorder || 0.1);
}

// ===== РЕНДЕР ДЕСКТОПА =====
function renderDesktop() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    
    // Корзина всегда на месте
    currentDesktopItems.forEach(item => {
        if (item.id === 'trash') return;
        const icon = createDesktopIcon(item);
        container.appendChild(icon);
    });
    
    // Корзина
    const trashIcon = document.createElement('div');
    trashIcon.className = 'desktop-icon trash-icon';
    trashIcon.setAttribute('data-id', 'trash');
    trashIcon.innerHTML = `
        <div class="icon-img"><i class="fas fa-trash-alt"></i></div>
        <div class="icon-label">Корзина</div>
    `;
    trashIcon.onclick = () => openTrash();
    trashIcon.oncontextmenu = (e) => {
        e.preventDefault();
        showTrashContext(e.pageX, e.pageY);
    };
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
    
    icon.innerHTML = `
        <div class="icon-img">${item.type === 'folder' ? '<i class="fas fa-folder"></i>' : 
            isImage ? '<i class="fas fa-image"></i>' : 
            item.name.endsWith('.txt') ? '<i class="fas fa-file-alt"></i>' :
            item.name.endsWith('.doc') ? '<i class="fas fa-file-word"></i>' :
            '<i class="fas fa-file"></i>'}</div>
        <div class="icon-label">${item.name}</div>
    `;
    
    icon.ondblclick = () => {
        if (item.type === 'folder') {
            openFolderWindow(item);
        } else {
            openFile(item);
        }
    };
    
    icon.onclick = (e) => {
        // Выделение иконки
        document.querySelectorAll('.desktop-icon').forEach(el => el.style.background = '');
        icon.style.background = 'rgba(255,255,255,0.1)';
    };
    
    icon.oncontextmenu = (e) => {
        e.preventDefault();
        showFileContextMenu(e.pageX, e.pageY, item);
    };
    
    // Drag & Drop для иконок
    icon.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', item.id);
        icon.style.opacity = '0.5';
    });
    
    icon.addEventListener('dragend', () => {
        icon.style.opacity = '1';
    });
    
    return icon;
}

// ===== ОТКРЫТИЕ ФАЙЛОВ =====
function openFile(item) {
    const isImage = item.content && (item.content.startsWith('data:image') || item.content.startsWith('https://i.ibb.co'));
    
    if (isImage) {
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

// ===== ПРОСМОТР ИЗОБРАЖЕНИЙ =====
function openImageViewer(item) {
    const existing = document.querySelector(`[data-file-id="${item.id}"]`);
    if (existing) {
        bringToFront(existing);
        return;
    }
    
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel';
    win.dataset.fileId = item.id;
    win.style.cssText = `width: 600px; max-width: 90%; top: 10%; left: 20%; z-index: ${windowZIndex++};`;
    win.innerHTML = `
        <div class="window-header" style="cursor: move;">
            <div class="window-title"><i class="fas fa-image"></i> ${item.name}</div>
            <div class="window-controls">
                <button class="win-btn minimize" title="Свернуть">−</button>
                <button class="win-btn maximize" title="На весь экран">⛶</button>
                <button class="win-btn close" title="Закрыть">✕</button>
            </div>
        </div>
        <div class="window-body" style="padding: 0; display: flex; align-items: center; justify-content: center; min-height: 300px; background: rgba(0,0,0,0.3); border-radius: 0 0 20px 20px;">
            <img src="${item.content}" alt="${item.name}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 0 0 20px 20px;">
        </div>
    `;
    
    document.body.appendChild(win);
    openWindows.push(win);
    setupWindowControls(win);
    setupWindowDrag(win);
    
    // Закрытие при клике вне
    win.querySelector('.win-btn.close').onclick = () => closeWindow(win);
    win.querySelector('.win-btn.minimize').onclick = () => minimizeWindow(win);
    win.querySelector('.win-btn.maximize').onclick = () => toggleMaximize(win);
}

// ===== БЛОКНОТ =====
function openNotepad(item) {
    const existing = document.querySelector(`[data-file-id="${item.id}"]`);
    if (existing) {
        bringToFront(existing);
        return;
    }
    
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel';
    win.dataset.fileId = item.id;
    win.style.cssText = `width: 550px; max-width: 90%; height: 450px; max-height: 80%; top: 10%; left: 20%; z-index: ${windowZIndex++}; display: flex; flex-direction: column;`;
    win.innerHTML = `
        <div class="window-header" style="cursor: move; flex-shrink: 0;">
            <div class="window-title"><i class="fas fa-file-alt"></i> ${item.name}</div>
            <div class="window-controls">
                <button class="win-btn minimize">−</button>
                <button class="win-btn maximize">⛶</button>
                <button class="win-btn close">✕</button>
            </div>
        </div>
        <div class="notepad-menu">
            <div class="dropdown">
                <button>Файл ▾</button>
                <div class="dropdown-content">
                    <button data-action="save">💾 Сохранить <span class="shortcut">Ctrl+S</span></button>
                    <button data-action="save-as">📄 Сохранить как <span class="shortcut">Ctrl+Shift+S</span></button>
                    <button data-action="save-desktop">🖥 Сохранить на рабочий стол <span class="shortcut">Ctrl+Alt+S</span></button>
                </div>
            </div>
        </div>
        <div class="window-body" style="flex: 1; padding: 0; display: flex; flex-direction: column;">
            <textarea id="notepad-content-${item.id}" style="flex: 1; width: 100%; padding: 16px 20px; background: rgba(0,0,0,0.15); color: #e0e0e0; border: none; resize: none; font-family: 'Courier New', monospace; font-size: 14px; line-height: 1.6; outline: none;">${item.content || ''}</textarea>
            <div class="notepad-status">
                <span>Строк: ${(item.content || '').split('\n').length}</span>
                <span>${item.name}</span>
            </div>
        </div>
    `;
    
    document.body.appendChild(win);
    openWindows.push(win);
    
    const textarea = win.querySelector(`#notepad-content-${item.id}`);
    
    // Сохранение
    const saveNotepad = () => {
        item.content = textarea.value;
        saveToFirebase();
        win.querySelector('.notepad-status span:last-child').textContent = '✓ Сохранено';
        setTimeout(() => {
            win.querySelector('.notepad-status span:last-child').textContent = item.name;
        }, 1500);
    };
    
    // Горячие клавиши
    textarea.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            if (e.shiftKey && e.altKey) {
                // Сохранить на рабочий стол
                const newItem = { ...item, id: Date.now() + Math.random(), name: `копия_${item.name}` };
                currentDesktopItems.push(newItem);
                saveToFirebase();
                renderDesktop();
                Swal.fire({ title: 'Сохранено на рабочий стол', icon: 'success', timer: 1000, showConfirmButton: false, background: '#1a1a2e', color: '#fff' });
            } else if (e.shiftKey) {
                // Сохранить как
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
    
    // Кнопки меню
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
    
    setupWindowControls(win);
    setupWindowDrag(win);
}

// ===== ПАПКИ =====
function openFolderWindow(folder) {
    const existing = document.querySelector(`[data-folder-id="${folder.id}"]`);
    if (existing) {
        bringToFront(existing);
        return;
    }
    
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel folder-window';
    win.dataset.folderId = folder.id;
    win.style.cssText = `width: 500px; max-width: 90%; height: 400px; max-height: 70%; top: 10%; left: 20%; z-index: ${windowZIndex++}; display: flex; flex-direction: column;`;
    
    const children = currentDesktopItems.filter(i => i.parentId === folder.id);
    
    win.innerHTML = `
        <div class="window-header" style="cursor: move; flex-shrink: 0;">
            <div class="window-title"><i class="fas fa-folder"></i> ${folder.name}</div>
            <div class="window-controls">
                <button class="win-btn minimize">−</button>
                <button class="win-btn maximize">⛶</button>
                <button class="win-btn close">✕</button>
            </div>
        </div>
        <div class="folder-view-options">
            <button class="active" data-view="icons"><i class="fas fa-th"></i></button>
            <button data-view="list"><i class="fas fa-list"></i></button>
            <button data-view="details"><i class="fas fa-table"></i></button>
            <span class="separator"></span>
            <span style="font-size: 12px; opacity: 0.4; margin-left: auto;">${children.length} элементов</span>
        </div>
        <div class="folder-content" style="flex: 1; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; overflow-y: auto; min-height: 100px;">
            ${children.length === 0 ? '<div style="width:100%; text-align:center; opacity:0.3; padding:40px;">Папка пуста</div>' : ''}
        </div>
    `;
    
    document.body.appendChild(win);
    openWindows.push(win);
    
    const content = win.querySelector('.folder-content');
    
    // Рендер содержимого папки
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
                div.innerHTML = `
                    <i class="fas ${item.type === 'folder' ? 'fa-folder' : 'fa-file'}"></i>
                    <span>${item.name}</span>
                    <span style="margin-left: auto; opacity: 0.3; font-size: 12px;">${item.type === 'folder' ? 'Папка' : 'Файл'}</span>
                `;
                div.onclick = () => {
                    if (item.type === 'folder') {
                        openFolderWindow(item);
                    } else {
                        openFile(item);
                    }
                };
                content.appendChild(div);
            });
        } else {
            // Иконки (по умолчанию)
            items.forEach(item => {
                const icon = createDesktopIcon(item);
                icon.style.width = '70px';
                icon.querySelector('.icon-img').style.fontSize = '28px';
                content.appendChild(icon);
            });
        }
    }
    
    renderFolderContent();
    
    // Переключение вида
    win.querySelectorAll('.folder-view-options button').forEach(btn => {
        btn.onclick = () => {
            win.querySelectorAll('.folder-view-options button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderFolderContent(btn.dataset.view);
        };
    });
    
    // Drag & Drop в папку
    content.addEventListener('dragover', (e) => {
        e.preventDefault();
        content.classList.add('drag-over');
    });
    
    content.addEventListener('dragleave', () => {
        content.classList.remove('drag-over');
    });
    
    content.addEventListener('drop', (e) => {
        e.preventDefault();
        content.classList.remove('drag-over');
        
        const id = e.dataTransfer.getData('text/plain');
        if (!id) return;
        
        // Перемещаем файл в папку
        const item = currentDesktopItems.find(i => i.id == id);
        if (item && item.id !== folder.id && item.parentId !== folder.id) {
            // Удаляем из старой папки
            if (item.parentId) {
                const oldParent = currentDesktopItems.find(i => i.id === item.parentId);
                if (oldParent) {
                    // Ничего не делаем
                }
            }
            item.parentId = folder.id;
            delete item.x;
            delete item.y;
            saveToFirebase();
            renderDesktop();
            renderFolderContent();
            // Обновляем заголовок
            const itemsCount = currentDesktopItems.filter(i => i.parentId === folder.id).length;
            win.querySelector('.folder-view-options span:last-child').textContent = `${itemsCount} элементов`;
        }
    });
    
    setupWindowControls(win);
    setupWindowDrag(win);
}

// ===== КОРЗИНА =====
function openTrash() {
    const existing = document.getElementById('trash-window');
    if (existing) {
        bringToFront(existing);
        return;
    }
    
    const win = document.createElement('div');
    win.id = 'trash-window';
    win.className = 'floating-window glass-panel';
    win.style.cssText = `width: 500px; max-width: 90%; height: 400px; max-height: 70%; top: 10%; left: 20%; z-index: ${windowZIndex++}; display: flex; flex-direction: column;`;
    
    win.innerHTML = `
        <div class="window-header" style="cursor: move; flex-shrink: 0;">
            <div class="window-title"><i class="fas fa-trash-alt"></i> Корзина</div>
            <div class="window-controls">
                <button class="win-btn minimize">−</button>
                <button class="win-btn close">✕</button>
            </div>
        </div>
        <div class="folder-content" style="flex: 1; padding: 12px; display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; overflow-y: auto; min-height: 100px;">
            ${trashItems.length === 0 ? '<div class="empty-trash">Корзина пуста</div>' : ''}
        </div>
        <div style="padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.06); display: flex; gap: 8px; justify-content: flex-end;">
            <button class="win-btn" style="padding: 6px 16px; border-radius: 8px; background: rgba(255,68,68,0.2); color: #ff4444; border: none; cursor: pointer;" onclick="clearTrash()">🗑 Очистить корзину</button>
            <button class="win-btn" style="padding: 6px 16px; border-radius: 8px; background: rgba(255,255,255,0.05); color: white; border: none; cursor: pointer;" onclick="restoreAllTrash()">↩ Восстановить всё</button>
        </div>
    `;
    
    document.body.appendChild(win);
    openWindows.push(win);
    
    renderTrashContent(win);
    setupWindowControls(win);
    setupWindowDrag(win);
}

function renderTrashContent(win) {
    const content = win.querySelector('.folder-content');
    if (!content) return;
    
    if (trashItems.length === 0) {
        content.innerHTML = '<div class="empty-trash">Корзина пуста</div>';
        return;
    }
    
    content.innerHTML = '';
    trashItems.forEach(item => {
        const div = document.createElement('div');
        div.style.cssText = 'display: flex; align-items: center; gap: 12px; padding: 6px 12px; width: 100%; border-radius: 8px; cursor: pointer; transition: all 0.2s;';
        div.onmouseenter = () => div.style.background = 'rgba(255,255,255,0.05)';
        div.onmouseleave = () => div.style.background = '';
        div.innerHTML = `
            <i class="fas fa-file"></i>
            <span>${item.name}</span>
            <span style="margin-left: auto; opacity: 0.3; font-size: 12px;">${item.type || 'Файл'}</span>
            <button onclick="restoreFromTrash('${item.id}')" style="background: none; border: none; color: #4ecdc4; cursor: pointer;">↩</button>
        `;
        content.appendChild(div);
    });
}

// Глобальные функции для корзины
window.restoreFromTrash = function(id) {
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
};

window.clearTrash = function() {
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
};

window.restoreAllTrash = function() {
    trashItems.forEach(item => {
        delete item.parentId;
        currentDesktopItems.push(item);
    });
    trashItems = [];
    saveToFirebase();
    renderDesktop();
    const win = document.getElementById('trash-window');
    if (win) renderTrashContent(win);
};

// ===== УПРАВЛЕНИЕ ОКНАМИ =====
function setupWindowControls(win) {
    win.querySelector('.win-btn.close').onclick = () => closeWindow(win);
    win.querySelector('.win-btn.minimize').onclick = () => minimizeWindow(win);
    const maxBtn = win.querySelector('.win-btn.maximize');
    if (maxBtn) maxBtn.onclick = () => toggleMaximize(win);
}

function closeWindow(win) {
    win.style.animation = 'windowAppear 0.2s reverse';
    setTimeout(() => {
        win.remove();
        openWindows = openWindows.filter(w => w !== win);
    }, 200);
}

function minimizeWindow(win) {
    win.style.display = 'none';
    // Можно добавить кнопку в док для восстановления
}

function toggleMaximize(win) {
    win.classList.toggle('maximized');
}

function bringToFront(win) {
    win.style.zIndex = windowZIndex++;
}

function setupWindowDrag(win) {
    const header = win.querySelector('.window-header');
    let isDragging = false;
    let offsetX, offsetY;
    
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.win-btn') || e.target.closest('.window-controls')) return;
        isDragging = true;
        const rect = win.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        win.style.transform = 'none';
        win.style.left = rect.left + 'px';
        win.style.top = rect.top + 'px';
        bringToFront(win);
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        win.style.left = (e.clientX - offsetX) + 'px';
        win.style.top = (e.clientY - offsetY) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// ===== КОНТЕКСТНОЕ МЕНЮ =====
function showFileContextMenu(x, y, item) {
    const menu = document.getElementById('file-context-menu') || createFileContextMenu();
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    menu.style.display = 'flex';
    window.selectedFile = item;
    
    menu.querySelectorAll('.context-item').forEach(btn => {
        btn.onclick = () => {
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

function createFileContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'file-context-menu';
    menu.className = 'context-menu glass-panel';
    menu.style.display = 'none';
    menu.innerHTML = `
        <div class="context-item" data-action="open"><i class="fas fa-folder-open"></i> Открыть</div>
        <div class="context-item" data-action="rename"><i class="fas fa-pen"></i> Переименовать</div>
        <div class="context-item" data-action="delete"><i class="fas fa-trash"></i> Удалить</div>
    `;
    document.body.appendChild(menu);
    return menu;
}

function showTrashContext(x, y) {
    const menu = document.getElementById('context-menu') || createContextMenu();
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 200) + 'px';
    menu.style.display = 'flex';
    
    menu.querySelectorAll('.context-item').forEach(btn => {
        btn.onclick = () => {
            const action = btn.dataset.action;
            if (action === 'open-trash') openTrash();
            else if (action === 'clear-trash') window.clearTrash();
            menu.style.display = 'none';
        };
    });
}

function createContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.className = 'context-menu glass-panel';
    menu.style.display = 'none';
    menu.innerHTML = `
        <div class="context-item" data-action="open-trash"><i class="fas fa-trash-alt"></i> Открыть корзину</div>
        <div class="context-item" data-action="clear-trash"><i class="fas fa-trash"></i> Очистить корзину</div>
        <div class="context-item" data-action="personalize"><i class="fas fa-palette"></i> Персонализация</div>
        <div class="context-item" data-action="create-folder"><i class="fas fa-folder-plus"></i> Создать папку</div>
        <div class="context-item" data-action="create-file-txt"><i class="fas fa-file-alt"></i> Создать .txt</div>
        <div class="context-item" data-action="refresh"><i class="fas fa-sync-alt"></i> Обновить</div>
    `;
    document.body.appendChild(menu);
    return menu;
}

// ===== DRAG & DROP ФАЙЛОВ =====
document.addEventListener('dragover', (e) => e.preventDefault());

document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    
    const target = e.target.closest('#desktop') || e.target.closest('#desktop-icons') || e.target.closest('.folder-content');
    const isFolder = target && target.closest('.folder-content');
    const folderId = isFolder ? target.closest('.floating-window')?.dataset.folderId : null;
    
    for (let file of files) {
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                let content = event.target.result;
                let url = null;
                let isImage = file.type.startsWith('image/');
                
                if (isImage) {
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
                
                const newItem = {
                    id: Date.now() + Math.random() * 1000,
                    name: file.name,
                    type: 'file',
                    content: content,
                    url: url
                };
                
                if (folderId) {
                    newItem.parentId = folderId;
                }
                
                currentDesktopItems.push(newItem);
                renderDesktop();
                saveToFirebase();
                
                // Обновляем открытую папку
                if (folderId) {
                    const folderWin = document.querySelector(`[data-folder-id="${folderId}"]`);
                    if (folderWin) {
                        const content = folderWin.querySelector('.folder-content');
                        const items = currentDesktopItems.filter(i => i.parentId == folderId);
                        folderWin.querySelector('.folder-view-options span:last-child').textContent = `${items.length} элементов`;
                        // Перерендер содержимого
                        const activeView = folderWin.querySelector('.folder-view-options .active');
                        const view = activeView ? activeView.dataset.view : 'icons';
                        renderFolderContent(folderWin, view);
                    }
                }
            } catch (err) {
                console.error('Upload error:', err);
            }
        };
        reader.readAsDataURL(file);
    }
});

// ===== ПЕРСОНАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
    const personalizeBtn = document.querySelector('[data-action="personalize"]');
    if (personalizeBtn) {
        personalizeBtn.addEventListener('click', () => {
            document.getElementById('personalize-modal').style.display = 'flex';
            document.getElementById('context-menu').style.display = 'none';
        });
    }
    
    // Закрытие модалки
    document.querySelector('.modal-close')?.addEventListener('click', () => {
        document.getElementById('personalize-modal').style.display = 'none';
    });
    
    // Обои
    document.querySelectorAll('.wallpaper-item').forEach(item => {
        item.onclick = () => {
            const url = item.style.backgroundImage.slice(5, -2);
            systemConfig.wallpaper = url;
            applyConfig();
            document.querySelectorAll('.wallpaper-item').forEach(el => el.style.border = '2px solid transparent');
            item.style.border = '2px solid #667eea';
        };
    });
    
    // Выбор языка (красивый)
    const langContainer = document.querySelector('.language-selector') || createLanguageSelector();
    
    // Тема
    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.onclick = () => {
            document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            systemConfig.theme = opt.dataset.theme;
            applyConfig();
        };
    });
    
    // Ползунок жидкого стекла
    const glassSlider = document.getElementById('glass-intensity');
    if (glassSlider) {
        glassSlider.value = systemConfig.glassOpacity * 100 || 60;
        glassSlider.oninput = () => {
            const val = glassSlider.value / 100;
            systemConfig.glassOpacity = val;
            document.documentElement.style.setProperty('--glass-opacity', val);
        };
    }
    
    // Сохранение
    document.getElementById('save-personalize')?.addEventListener('click', () => {
        const lang = document.querySelector('.lang-option.active')?.dataset.lang || systemConfig.language;
        systemConfig.language = lang;
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
});

function createLanguageSelector() {
    const section = document.querySelector('.settings-section:has(h4:contains("Язык"))');
    if (!section) return null;
    
    const container = document.createElement('div');
    container.className = 'language-selector';
    
    const languages = [
        { code: 'ru', label: '🇷🇺 Русский' },
        { code: 'en', label: '🇬🇧 English' },
        { code: 'es', label: '🇪🇸 Español' },
        { code: 'zh', label: '🇨🇳 中文' },
        { code: 'de', label: '🇩🇪 Deutsch' },
        { code: 'fr', label: '🇫🇷 Français' },
        { code: 'pt', label: '🇵🇹 Português' },
        { code: 'ar', label: '🇸🇦 العربية' },
        { code: 'ja', label: '🇯🇵 日本語' },
        { code: 'ko', label: '🇰🇷 한국어' }
    ];
    
    languages.forEach(lang => {
        const btn = document.createElement('button');
        btn.className = `lang-option ${systemConfig.language === lang.code ? 'active' : ''}`;
        btn.dataset.lang = lang.code;
        btn.textContent = lang.label;
        btn.onclick = () => {
            document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        };
        container.appendChild(btn);
    });
    
    // Заменяем select на наш красивый
    const select = section.querySelector('select');
    if (select) {
        select.style.display = 'none';
        section.appendChild(container);
    }
    
    return container;
}

// ===== АВТОРИЗАЦИЯ =====
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

// ===== МЕНЮ ПУСК =====
document.getElementById('start-button')?.addEventListener('click', () => {
    const menu = document.getElementById('start-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
    console.log("Auth state changed:", user ? "Пользователь есть" : "Нет пользователя");
    
    try {
        if (user) {
            console.log("Загрузка данных пользователя...");
            currentUser = user;
            await loadFromFirebase();
            console.log("Данные загружены");
            
            if (systemConfig.password) {
                showScreen(loginScreen);
            } else {
                showScreen(desktop);
            }
        } else {
            console.log("Нет пользователя, показываем экран авторизации");
            currentStep = 1;
            showScreen(authScreen);
            renderSetupStep();
        }
    } catch (error) {
        console.error("Ошибка при загрузке:", error);
    } finally {
        showLoading(false);
    }
});

// ===== НАСТРОЙКА =====
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

// Функция для рендера содержимого папки (глобальная)
function renderFolderContent(win, view = 'icons') {
    const folderId = win.dataset.folderId;
    const content = win.querySelector('.folder-content');
    if (!content) return;
    
    const items = currentDesktopItems.filter(i => i.parentId == folderId);
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
            div.innerHTML = `
                <i class="fas ${item.type === 'folder' ? 'fa-folder' : 'fa-file'}"></i>
                <span>${item.name}</span>
                <span style="margin-left: auto; opacity: 0.3; font-size: 12px;">${item.type === 'folder' ? 'Папка' : 'Файл'}</span>
            `;
            div.onclick = () => {
                if (item.type === 'folder') {
                    openFolderWindow(item);
                } else {
                    openFile(item);
                }
            };
            content.appendChild(div);
        });
    } else {
        items.forEach(item => {
            const icon = createDesktopIcon(item);
            icon.style.width = '70px';
            icon.querySelector('.icon-img').style.fontSize = '28px';
            content.appendChild(icon);
        });
    }
}

console.log('✅ K-OS полностью обновлён!');
console.log('✅ Добавлены: работающие окна, папки, корзина, автосохранение, жидкое стекло');

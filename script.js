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
let openWindows = [];
let windowZIndex = 1000;
let selectedFile = null;
let isDragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;
let dragWindow = null;
let dragData = null;

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const desktop = document.getElementById('desktop');

// ===== АВТОСОХРАНЕНИЕ =====
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
    if (desktop) {
        desktop.style.backgroundImage = `url(${systemConfig.wallpaper})`;
        desktop.style.backgroundSize = 'cover';
        desktop.style.backgroundPosition = 'center';
        desktop.style.backgroundRepeat = 'no-repeat';
    }
    
    document.body.classList.toggle('light-theme', systemConfig.theme === 'light');
    document.documentElement.style.setProperty('--glass-opacity', systemConfig.glassOpacity || 0.6);
    document.documentElement.style.setProperty('--glass-blur', (systemConfig.glassBlur || 20) + 'px');
    document.documentElement.style.setProperty('--glass-border', systemConfig.glassBorder || 0.1);
}

// ===== РЕНДЕР ДЕСКТОПА =====
function renderDesktop() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    
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
    
    let iconClass = 'fa-file';
    if (item.type === 'folder') iconClass = 'fa-folder';
    else if (isImage) iconClass = 'fa-image';
    else if (item.name.endsWith('.txt')) iconClass = 'fa-file-alt';
    else if (item.name.endsWith('.doc')) iconClass = 'fa-file-word';
    
    icon.innerHTML = `
        <div class="icon-img"><i class="fas ${iconClass}"></i></div>
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
        document.querySelectorAll('.desktop-icon').forEach(el => el.style.background = '');
        icon.style.background = 'rgba(255,255,255,0.1)';
    };
    
    icon.oncontextmenu = (e) => {
        e.preventDefault();
        showFileContextMenu(e.pageX, e.pageY, item);
    };
    
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
    
    const win = createWindow({
        title: item.name,
        icon: 'fa-image',
        fileId: item.id,
        width: 600,
        height: 'auto',
        body: `<img src="${item.content}" alt="${item.name}" style="max-width: 100%; max-height: 70vh; object-fit: contain; border-radius: 0 0 20px 20px; display: block;">`,
        bodyStyle: 'padding: 0; display: flex; align-items: center; justify-content: center; min-height: 300px; background: rgba(0,0,0,0.3); border-radius: 0 0 20px 20px;'
    });
    
    document.body.appendChild(win);
    openWindows.push(win);
}

// ===== БЛОКНОТ =====
function openNotepad(item) {
    const existing = document.querySelector(`[data-file-id="${item.id}"]`);
    if (existing) {
        bringToFront(existing);
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
            <textarea class="notepad-textarea" placeholder="Введите текст..." style="flex: 1; width: 100%; padding: 16px 20px; background: rgba(0,0,0,0.15); color: #e0e0e0; border: none; resize: none; font-family: 'Courier New', monospace; font-size: 14px; line-height: 1.6; outline: none;">${item.content || ''}</textarea>
            <div class="notepad-status">
                <span>Строк: ${(item.content || '').split('\n').length}</span>
                <span>${item.name}</span>
            </div>
        `,
        bodyStyle: 'padding: 0; display: flex; flex-direction: column; flex: 1;'
    });
    
    document.body.appendChild(win);
    openWindows.push(win);
    
    const textarea = win.querySelector('.notepad-textarea');
    
    // Сохранение
    const saveNotepad = () => {
        if (!textarea) return;
        item.content = textarea.value;
        saveToFirebase();
        const status = win.querySelector('.notepad-status span:last-child');
        if (status) {
            status.textContent = '✓ Сохранено';
            setTimeout(() => {
                status.textContent = item.name;
            }, 1500);
        }
    };
    
    // Горячие клавиши
    if (textarea) {
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
    }
    
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
}

// ===== СОЗДАНИЕ ОКНА (универсальное) =====
function createWindow(options) {
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel';
    if (options.fileId) win.dataset.fileId = options.fileId;
    if (options.folderId) win.dataset.folderId = options.folderId;
    
    const width = options.width || 500;
    const height = options.height || 'auto';
    win.style.cssText = `width: ${width}px; max-width: 90%; ${height !== 'auto' ? `height: ${height}px; max-height: 80%;` : ''} top: 10%; left: 20%; z-index: ${windowZIndex++}; display: flex; flex-direction: column;`;
    
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
    
    // Навешиваем события на кнопки
    const closeBtn = win.querySelector('.win-btn.close');
    const minBtn = win.querySelector('.win-btn.minimize');
    const maxBtn = win.querySelector('.win-btn.maximize');
    
    if (closeBtn) closeBtn.onclick = () => closeWindow(win);
    if (minBtn) minBtn.onclick = () => minimizeWindow(win);
    if (maxBtn) maxBtn.onclick = () => toggleMaximize(win);
    
    // Добавляем hover эффекты для кнопок
    win.querySelectorAll('.win-btn').forEach(btn => {
        btn.onmouseenter = () => {
            if (btn.classList.contains('close')) {
                btn.style.background = '#ff4444';
                btn.style.color = 'white';
            } else if (btn.classList.contains('maximize')) {
                btn.style.background = '#44ff88';
                btn.style.color = '#1a1a2e';
            } else if (btn.classList.contains('minimize')) {
                btn.style.background = '#ffaa44';
                btn.style.color = '#1a1a2e';
            }
        };
        btn.onmouseleave = () => {
            btn.style.background = 'rgba(255,255,255,0.06)';
            btn.style.color = 'rgba(255,255,255,0.6)';
        };
    });
    
    // Перетаскивание окна
    const header = win.querySelector('.window-header');
    if (header) {
        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('.win-btn') || e.target.closest('.window-controls')) return;
            startDrag(win, e);
        });
    }
    
    return win;
}

// ===== УПРАВЛЕНИЕ ОКНАМИ =====
function closeWindow(win) {
    win.style.animation = 'windowAppear 0.2s reverse';
    setTimeout(() => {
        win.remove();
        openWindows = openWindows.filter(w => w !== win);
    }, 200);
}

function minimizeWindow(win) {
    win.style.display = 'none';
}

function toggleMaximize(win) {
    win.classList.toggle('maximized');
}

function bringToFront(win) {
    win.style.zIndex = windowZIndex++;
}

// ===== ПЕРЕТАСКИВАНИЕ ОКОН =====
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

// ===== ПАПКИ =====
function openFolderWindow(folder) {
    const existing = document.querySelector(`[data-folder-id="${folder.id}"]`);
    if (existing) {
        bringToFront(existing);
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
                // Добавляем возможность перетаскивать из папки
                div.draggable = true;
                div.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    dragData = { id: item.id };
                    div.style.opacity = '0.5';
                });
                div.addEventListener('dragend', () => {
                    div.style.opacity = '1';
                });
                content.appendChild(div);
            });
        } else {
            items.forEach(item => {
                const icon = createDesktopIcon(item);
                icon.style.width = '70px';
                const img = icon.querySelector('.icon-img');
                if (img) img.style.fontSize = '28px';
                // Добавляем возможность перетаскивать из папки
                icon.draggable = true;
                icon.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', item.id);
                    dragData = { id: item.id };
                    icon.style.opacity = '0.5';
                });
                icon.addEventListener('dragend', () => {
                    icon.style.opacity = '1';
                });
                content.appendChild(icon);
            });
        }
    }

    renderFolderContent();

    // Переключение вида
    win.querySelectorAll('.view-btn').forEach(btn => {
        btn.onclick = () => {
            win.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderFolderContent(btn.dataset.view);
        };
    });

    // Drag & Drop в папку
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
            // Если файл был на рабочем столе с позицией - убираем позицию
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

// ===== КОРЗИНА =====
function openTrash() {
    const existing = document.getElementById('trash-window');
    if (existing) {
        bringToFront(existing);
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
    
    renderTrashContent(win);
    
    // Кнопки
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
    
    // Вешаем события на кнопки восстановления
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

// ===== КОНТЕКСТНОЕ МЕНЮ =====
function showFileContextMenu(x, y, item) {
    // Закрываем меню рабочего стола
    const desktopMenu = document.getElementById('context-menu');
    if (desktopMenu) desktopMenu.style.display = 'none';
    
    const menu = document.getElementById('file-context-menu');
    if (!menu) return;
    
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
    // Закрываем меню рабочего стола
    const desktopMenu = document.getElementById('context-menu');
    if (desktopMenu) desktopMenu.style.display = 'none';
    
    const menu = document.getElementById('file-context-menu');
    if (!menu) return;
    
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 180) + 'px';
    menu.style.display = 'flex';
    
    // Очищаем и заполняем меню для корзины
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

// ===== ПКМ ПО РАБОЧЕМУ СТОЛУ =====
desktop?.addEventListener('contextmenu', (e) => {
    // Проверяем что клик именно по рабочему столу, а не по иконке
    if (e.target === desktop || e.target.id === 'desktop-icons' || e.target.closest('#desktop-icons')) {
        e.preventDefault();
        e.stopPropagation();
        
        // Закрываем меню файла
        const fileMenu = document.getElementById('file-context-menu');
        if (fileMenu) fileMenu.style.display = 'none';
        
        const menu = document.getElementById('context-menu');
        if (menu) {
            menu.style.left = Math.min(e.pageX, window.innerWidth - 220) + 'px';
            menu.style.top = Math.min(e.pageY, window.innerHeight - 250) + 'px';
            menu.style.display = 'flex';
            
            // Обновляем обработчики для пунктов меню
            menu.querySelectorAll('.context-item').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    if (action === 'open-trash') openTrash();
                    else if (action === 'clear-trash') clearTrash();
                    else if (action === 'personalize') {
                        document.getElementById('personalize-modal').style.display = 'flex';
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
                    } else if (action === 'refresh') {
                        renderDesktop();
                    }
                    menu.style.display = 'none';
                };
            });
        }
    }
});

// ===== DRAG & DROP ФАЙЛОВ =====
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
                
                currentDesktopItems.push({
                    id: Date.now() + Math.random(),
                    name: file.name,
                    type: 'file',
                    content: content,
                    url: url
                });
                renderDesktop();
                saveToFirebase();
            } catch (err) {
                console.error('Upload error:', err);
            }
        };
        reader.readAsDataURL(file);
    }
});

// ===== ПЕРСОНАЛИЗАЦИЯ =====
document.addEventListener('DOMContentLoaded', () => {
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
    
    // Язык
    document.querySelectorAll('.lang-option').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.lang-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            systemConfig.language = btn.dataset.lang;
        };
    });
    
    // Тема
    document.querySelectorAll('.theme-option').forEach(opt => {
        opt.onclick = () => {
            document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            systemConfig.theme = opt.dataset.theme;
            applyConfig();
        };
    });
    
    // Жидкое стекло
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
    
    // Закрытие модалки
    document.querySelector('.modal-close')?.addEventListener('click', () => {
        document.getElementById('personalize-modal').style.display = 'none';
    });
});

// ===== МЕНЮ ПУСК =====
document.getElementById('start-button')?.addEventListener('click', () => {
    const menu = document.getElementById('start-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

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

// ===== AUTH STATE =====
onAuthStateChanged(auth, async (user) => {
    console.log("Auth state changed:", user ? "Пользователь есть" : "Нет пользователя");
    
    try {
        if (user) {
            currentUser = user;
            await loadFromFirebase();
            
            if (systemConfig.password) {
                showScreen(loginScreen);
            } else {
                showScreen(desktop);
            }
        } else {
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

// ===== ПЕРЕТАСКИВАНИЕ ФАЙЛОВ =====
document.addEventListener('dragstart', (e) => {
    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;
    const id = icon.dataset.id;
    if (id === 'trash') return;
    
    dragData = {
        id: id,
        element: icon
    };
    e.dataTransfer.setData('text/plain', id);
    icon.style.opacity = '0.5';
});

document.addEventListener('dragend', (e) => {
    const icon = e.target.closest('.desktop-icon');
    if (icon) icon.style.opacity = '1';
    dragData = null;
});

// Единый обработчик для рабочего стола
const desktopIcons = document.getElementById('desktop-icons');

desktopIcons?.addEventListener('dragover', (e) => {
    e.preventDefault();
});

desktopIcons?.addEventListener('drop', (e) => {
    e.preventDefault();
    
    const id = e.dataTransfer.getData('text/plain') || (dragData ? dragData.id : null);
    if (!id) return;
    
    const item = currentDesktopItems.find(i => i.id == id);
    if (!item) return;
    
    // Если файл был в папке, убираем его оттуда
    if (item.parentId) {
        delete item.parentId;
    }
    
    // Сохраняем позицию
    const rect = desktopIcons.getBoundingClientRect();
    item.x = e.clientX - rect.left - 42;
    item.y = e.clientY - rect.top - 42;
    
    saveToFirebase();
    renderDesktop();
    
    // Обновляем открытые папки
    document.querySelectorAll('.floating-window[data-folder-id]').forEach(win => {
        const folderId = win.dataset.folderId;
        if (folderId) {
            const folder = currentDesktopItems.find(i => i.id == folderId);
            if (folder) {
                // Закрываем и открываем заново
                win.remove();
                openWindows = openWindows.filter(w => w !== win);
                openFolderWindow(folder);
            }
        }
    });
    
    dragData = null;
});

console.log('✅ K-OS полностью обновлён!');
console.log('✅ Исправлены: движение окон, кнопки, контекстное меню, корзина');

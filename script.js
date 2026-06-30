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
    glassIntensity: 60
};
let clipboard = null;
let isDragging = false;
let dragData = null;

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const loginScreen = document.getElementById('login-screen');
const desktop = document.getElementById('desktop');

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function showLoading(show) {
    loadingScreen.style.display = show ? 'flex' : 'none';
}

function showScreen(screen) {
    const screens = [authScreen, loginScreen, desktop];
    screens.forEach(s => {
        if (s) s.style.display = 'none';
    });
    if (screen) {
        screen.style.display = 'flex';
        if (screen === desktop) {
            setTimeout(() => {
                const allChildren = desktop.querySelectorAll('*');
                allChildren.forEach(el => {
                    el.style.filter = 'none';
                    el.style.opacity = '1';
                });
            }, 100);
        }
    }
}

// ========== СОХРАНЕНИЕ В FIREBASE (ежесекундно) ==========
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
        console.error('Ошибка сохранения:', e);
    }
}

// Автосохранение каждую секунду
setInterval(saveToFirebase, 1000);

async function loadFromFirebase() {
    if (!currentUser) return;
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
}

// ========== ПРИМЕНЕНИЕ НАСТРОЕК ==========
function applyConfig() {
    if (desktop) {
        desktop.style.backgroundImage = `url(${systemConfig.wallpaper})`;
        desktop.style.backgroundSize = 'cover';
        desktop.style.backgroundPosition = 'center';
        desktop.style.backgroundRepeat = 'no-repeat';
    }
    
    // Тема
    const theme = systemConfig.theme || 'dark';
    document.body.className = theme + '-theme';
    
    // Жидкое стекло
    const intensity = systemConfig.glassIntensity || 60;
    const blurValue = 10 + (intensity / 100) * 30;
    const opacity = 0.3 + (intensity / 100) * 0.5;
    
    document.querySelectorAll('.glass-panel').forEach(el => {
        el.style.backdropFilter = `blur(${blurValue}px)`;
        el.style.background = `rgba(30, 30, 40, ${opacity})`;
    });
    
    document.querySelectorAll('.floating-window').forEach(el => {
        el.style.backdropFilter = `blur(${blurValue + 5}px)`;
        el.style.background = `rgba(30, 30, 40, ${opacity + 0.2})`;
    });
}

// ========== РЕНДЕР РАБОЧЕГО СТОЛА ==========
function renderDesktop() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    
    // Сортируем: папки сверху
    const sorted = [...currentDesktopItems].sort((a, b) => {
        if (a.type === 'folder' && b.type !== 'folder') return -1;
        if (a.type !== 'folder' && b.type === 'folder') return 1;
        return 0;
    });
    
    sorted.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.setAttribute('data-id', item.id);
        icon.setAttribute('draggable', 'true');
        
        if (item.x !== undefined && item.y !== undefined) {
            icon.style.position = 'absolute';
            icon.style.left = item.x + 'px';
            icon.style.top = item.y + 'px';
        }
        
        const iconMap = {
            folder: '<i class="fas fa-folder"></i>',
            txt: '<i class="fas fa-file-alt"></i>',
            doc: '<i class="fas fa-file-word"></i>',
            image: '<i class="fas fa-image"></i>',
            default: '<i class="fas fa-file"></i>'
        };
        
        let iconType = 'default';
        if (item.type === 'folder') iconType = 'folder';
        else if (item.name?.endsWith('.txt')) iconType = 'txt';
        else if (item.name?.endsWith('.doc')) iconType = 'doc';
        else if (item.url || item.type === 'image') iconType = 'image';
        
        icon.innerHTML = `
            <div class="icon-img">${iconMap[iconType]}</div>
            <div class="icon-label">${item.name || 'Без названия'}</div>
        `;
        
        // Двойной клик
        icon.ondblclick = () => {
            if (item.type === 'folder') openFolder(item);
            else openFile(item);
        };
        
        // Перетаскивание
        icon.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', item.id);
            dragData = { item, type: 'desktop' };
            icon.style.opacity = '0.5';
        });
        
        icon.addEventListener('dragend', () => {
            icon.style.opacity = '1';
            dragData = null;
        });
        
        // Правый клик
        icon.oncontextmenu = (e) => {
            e.preventDefault();
            showFileContextMenu(e.pageX, e.pageY, item);
        };
        
        container.appendChild(icon);
    });
    
    // Обновляем статус корзины
    updateTrashIcon();
}

// ========== ОТКРЫТИЕ ПАПКИ ==========
function openFolder(folder) {
    // Создаём окно папки
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel folder-window';
    win.style.cssText = 'width: 600px; height: 400px; top: 15%; left: 20%; z-index: 5000; display: flex; flex-direction: column;';
    win.setAttribute('data-folder-id', folder.id);
    
    win.innerHTML = `
        <div class="window-header">
            <div class="window-title">
                <i class="fas fa-folder"></i>
                <span>${folder.name}</span>
            </div>
            <div class="window-controls">
                <button class="window-btn-min" onclick="minimizeWindow(this.closest('.floating-window').id || '')">─</button>
                <button class="window-btn-max" onclick="toggleMaximize(this.closest('.floating-window'))">☐</button>
                <button class="window-btn-close" onclick="closeWindow(this.closest('.floating-window'))">✕</button>
            </div>
        </div>
        <div class="folder-toolbar">
            <select class="folder-view-select glass-select">
                <option value="icons">Огромные значки</option>
                <option value="small">Мелкие значки</option>
                <option value="list">Список</option>
                <option value="table">Таблица</option>
            </select>
            <span class="folder-file-count">${folder.children?.length || 0} элементов</span>
        </div>
        <div class="folder-content" id="folder-content-${folder.id}">
            ${(folder.children || []).map(child => `
                <div class="folder-item" data-id="${child.id}">
                    <div class="folder-item-icon">${child.type === 'folder' ? '📁' : '📄'}</div>
                    <div class="folder-item-name">${child.name}</div>
                </div>
            `).join('') || '<div class="folder-empty">Папка пуста</div>'}
        </div>
    `;
    
    document.body.appendChild(win);
    
    // Добавляем ID для управления
    const id = 'folder-window-' + Date.now();
    win.id = id;
    
    // Делаем окно перемещаемым
    makeDraggable(win);
    
    // Обработка перетаскивания в папку
    const content = win.querySelector('.folder-content');
    content.addEventListener('dragover', (e) => e.preventDefault());
    content.addEventListener('drop', (e) => {
        e.preventDefault();
        const target = e.target.closest('.floating-window');
        if (!target) return;
        const folderId = target.dataset.folderId;
        const folder = currentDesktopItems.find(i => i.id == folderId);
        if (!folder) return;
        
        // Проверяем, есть ли у нас данные о перетаскивании
        if (dragData) {
            // Перемещаем файл в папку
            const item = dragData.item;
            if (item && item.id !== folder.id) {
                // Удаляем с рабочего стола
                currentDesktopItems = currentDesktopItems.filter(i => i.id !== item.id);
                // Добавляем в папку
                if (!folder.children) folder.children = [];
                folder.children.push({...item});
                renderDesktop();
                // Обновляем окно папки
                refreshFolderWindow(folder.id);
            }
        }
    });
}

function refreshFolderWindow(folderId) {
    const windows = document.querySelectorAll('.folder-window');
    windows.forEach(win => {
        if (win.dataset.folderId == folderId) {
            const folder = currentDesktopItems.find(i => i.id == folderId);
            if (folder) {
                const content = win.querySelector('.folder-content');
                if (content) {
                    content.innerHTML = (folder.children || []).map(child => `
                        <div class="folder-item" data-id="${child.id}">
                            <div class="folder-item-icon">${child.type === 'folder' ? '📁' : '📄'}</div>
                            <div class="folder-item-name">${child.name}</div>
                        </div>
                    `).join('') || '<div class="folder-empty">Папка пуста</div>';
                    
                    const count = win.querySelector('.folder-file-count');
                    if (count) count.textContent = `${folder.children?.length || 0} элементов`;
                }
            }
        }
    });
}

// ========== ОТКРЫТИЕ ФАЙЛА ==========
function openFile(file) {
    // Изображение
    if (file.url || (file.content && file.content.startsWith('data:image'))) {
        const win = document.getElementById('viewer-window');
        win.style.display = 'flex';
        win.style.left = '20%';
        win.style.top = '15%';
        win.style.width = '60%';
        win.style.height = '70%';
        document.getElementById('viewer-image').src = file.url || file.content;
        document.getElementById('viewer-title').textContent = file.name || 'Изображение';
        makeDraggable(win);
        return;
    }
    
    // Текстовый файл
    if (file.name?.endsWith('.txt') || file.name?.endsWith('.doc')) {
        const win = document.getElementById('notepad-window');
        win.style.display = 'flex';
        win.style.left = '25%';
        win.style.top = '20%';
        win.style.width = '50%';
        win.style.height = '60%';
        document.getElementById('notepad-content').value = file.content || '';
        document.getElementById('notepad-title').textContent = file.name || 'Без названия.txt';
        window.currentFile = file;
        makeDraggable(win);
        return;
    }
    
    Swal.fire({
        title: 'Ошибка',
        text: 'Не удаётся открыть этот файл',
        icon: 'error',
        background: '#1a1a2e',
        color: '#fff'
    });
}

// ========== КОНТЕКСТНОЕ МЕНЮ ==========
function showFileContextMenu(x, y, item) {
    const menu = document.getElementById('file-context-menu');
    menu.style.left = Math.min(x, window.innerWidth - 220) + 'px';
    menu.style.top = Math.min(y, window.innerHeight - 300) + 'px';
    menu.style.display = 'flex';
    window.selectedFile = item;
    
    document.querySelectorAll('#file-context-menu .context-item').forEach(btn => {
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
                trashItems.push({...item});
                currentDesktopItems = currentDesktopItems.filter(i => i.id !== item.id);
                renderDesktop();
                saveToFirebase();
                updateTrashIcon();
            } else if (action === 'open') {
                if (item.type === 'folder') openFolder(item);
                else openFile(item);
            } else if (action === 'cut') {
                clipboard = { item, action: 'cut' };
            } else if (action === 'copy') {
                clipboard = { item, action: 'copy' };
            }
            menu.style.display = 'none';
        };
    });
}

// ========== КОРЗИНА ==========
function updateTrashIcon() {
    const trashIcon = document.getElementById('trash');
    if (trashIcon) {
        const count = trashItems.length;
        trashIcon.querySelector('.icon-label').textContent = count > 0 ? `Корзина (${count})` : 'Корзина';
        trashIcon.style.opacity = count > 0 ? '1' : '0.5';
    }
}

document.getElementById('trash')?.addEventListener('dblclick', () => {
    openTrash();
});

function openTrash() {
    const modal = document.getElementById('trash-modal');
    const content = document.getElementById('trash-content');
    
    if (trashItems.length === 0) {
        content.innerHTML = '<div class="trash-empty">Корзина пуста</div>';
    } else {
        content.innerHTML = trashItems.map((item, index) => `
            <div class="trash-item">
                <span>${item.type === 'folder' ? '📁' : '📄'} ${item.name}</span>
                <div class="trash-actions">
                    <button onclick="restoreItem(${index})" class="window-btn">Восстановить</button>
                    <button onclick="deletePermanently(${index})" class="window-btn" style="background: rgba(255,0,0,0.3);">Удалить навсегда</button>
                </div>
            </div>
        `).join('');
    }
    
    modal.style.display = 'flex';
}

function closeTrash() {
    document.getElementById('trash-modal').style.display = 'none';
}

function restoreItem(index) {
    const item = trashItems[index];
    if (item) {
        currentDesktopItems.push({...item});
        trashItems.splice(index, 1);
        renderDesktop();
        saveToFirebase();
        openTrash();
        updateTrashIcon();
    }
}

function deletePermanently(index) {
    trashItems.splice(index, 1);
    renderDesktop();
    saveToFirebase();
    openTrash();
    updateTrashIcon();
}

function emptyTrash() {
    Swal.fire({
        title: 'Очистить корзину?',
        text: 'Все файлы будут удалены навсегда',
        icon: 'warning',
        background: '#1a1a2e',
        color: '#fff',
        showCancelButton: true,
        confirmButtonText: 'Очистить',
        cancelButtonText: 'Отмена'
    }).then(result => {
        if (result.isConfirmed) {
            trashItems = [];
            renderDesktop();
            saveToFirebase();
            openTrash();
            updateTrashIcon();
        }
    });
}

// ========== УПРАВЛЕНИЕ ОКНАМИ ==========
window.minimizeWindow = function(id) {
    const win = typeof id === 'string' ? document.getElementById(id) : id;
    if (win) {
        if (win.dataset.minimized === 'true') {
            win.style.display = 'flex';
            win.dataset.minimized = 'false';
        } else {
            win.style.display = 'none';
            win.dataset.minimized = 'true';
        }
    }
};

window.toggleMaximize = function(id) {
    const win = typeof id === 'string' ? document.getElementById(id) : id;
    if (!win) return;
    
    if (win.dataset.maximized === 'true') {
        win.style.width = win.dataset.oldWidth || '50%';
        win.style.height = win.dataset.oldHeight || '60%';
        win.style.left = win.dataset.oldLeft || '20%';
        win.style.top = win.dataset.oldTop || '15%';
        win.dataset.maximized = 'false';
        win.querySelector('.window-btn-max').textContent = '☐';
    } else {
        win.dataset.oldWidth = win.style.width;
        win.dataset.oldHeight = win.style.height;
        win.dataset.oldLeft = win.style.left;
        win.dataset.oldTop = win.style.top;
        win.style.width = '100%';
        win.style.height = '100%';
        win.style.left =

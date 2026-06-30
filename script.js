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
        win.style.left = '0';
        win.style.top = '0';
        win.dataset.maximized = 'true';
        win.querySelector('.window-btn-max').textContent = '☐';
    }
};

window.closeWindow = function(id) {
    const win = typeof id === 'string' ? document.getElementById(id) : id;
    if (win) {
        if (win.id === 'notepad-window' || win.id === 'viewer-window') {
            win.style.display = 'none';
        } else {
            win.remove();
        }
    }
};

// ========== ПЕРЕТАСКИВАНИЕ ОКОН ==========
function makeDraggable(windowElement) {
    const header = windowElement.querySelector('.window-header');
    if (!header) return;
    
    let isDragging = false;
    let offsetX, offsetY;
    
    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.window-controls')) return;
        isDragging = true;
        const rect = windowElement.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        windowElement.style.transform = 'none';
        windowElement.style.left = rect.left + 'px';
        windowElement.style.top = rect.top + 'px';
        windowElement.style.position = 'fixed';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        windowElement.style.left = (e.clientX - offsetX) + 'px';
        windowElement.style.top = (e.clientY - offsetY) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
}

// ========== DRAG & DROP ФАЙЛОВ С КОМПЬЮТЕРА ==========
document.addEventListener('dragover', (e) => e.preventDefault());

document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    
    const target = e.target.closest('#desktop') || e.target.closest('#desktop-icons');
    if (!target) return;
    
    // Загружаем только ПЕРВЫЙ файл
    const file = files[0];
    
    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            let content = event.target.result;
            let url = null;
            let type = 'file';
            
            if (file.type.startsWith('image/')) {
                const formData = new FormData();
                formData.append('image', content.split(',')[1]);
                formData.append('key', IMGBB_KEY);
                const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                const json = await res.json();
                if (json.success) {
                    url = json.data.url;
                    content = url;
                    type = 'image';
                }
            }
            
            // Проверяем, есть ли уже такой файл
            const existing = currentDesktopItems.find(i => i.name === file.name);
            if (existing) {
                Swal.fire({
                    title: 'Файл уже существует',
                    text: `Файл "${file.name}" уже есть на рабочем столе`,
                    icon: 'warning',
                    background: '#1a1a2e',
                    color: '#fff'
                });
                return;
            }
            
            currentDesktopItems.push({
                id: Date.now() + Math.random(),
                name: file.name,
                type: type,
                content: content,
                url: url
            });
            renderDesktop();
            saveToFirebase();
        } catch (err) {
            console.error('Ошибка загрузки файла:', err);
            Swal.fire({
                title: 'Ошибка',
                text: 'Не удалось загрузить файл',
                icon: 'error',
                background: '#1a1a2e',
                color: '#fff'
            });
        }
    };
    reader.readAsDataURL(file);
});

// ========== АВТОРИЗАЦИЯ ==========
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
    if (pwd === systemConfig.password) showScreen(desktop);
    else Swal.fire('Ошибка', 'Неверный пароль', 'error');
});

document.getElementById('logout-full')?.addEventListener('click', () => signOut(auth));

// ========== AUTH STATE ==========
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
            showScreen(authScreen);
        }
    } catch (error) {
        console.error("Ошибка при загрузке:", error);
        Swal.fire({
            title: "Ошибка",
            text: "Не удалось загрузить систему: " + error.message,
            icon: "error",
            background: "#1a1a2e",
            color: "#fff"
        });
    } finally {
        showLoading(false);
    }
});

// ========== МЕНЮ ПУСК ==========
document.getElementById('start-button')?.addEventListener('click', () => {
    const menu = document.getElementById('start-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
});

document.addEventListener('click', (e) => {
    if (!e.target.closest('#start-button') && !e.target.closest('#start-menu')) {
        document.getElementById('start-menu').style.display = 'none';
    }
    if (!e.target.closest('.context-menu')) {
        document.getElementById('context-menu').style.display = 'none';
        document.getElementById('file-context-menu').style.display = 'none';
    }
});

// ========== ПЕРСОНАЛИЗАЦИЯ ==========
document.querySelector('[data-action="personalize"]')?.addEventListener('click', () => {
    document.getElementById('personalize-modal').style.display = 'flex';
});

document.querySelector('.modal-close')?.addEventListener('click', () => {
    document.getElementById('personalize-modal').style.display = 'none';
});

document.querySelectorAll('.wallpaper-item').forEach(item => {
    item.onclick = () => {
        systemConfig.wallpaper = item.style.backgroundImage.slice(5, -2);
        applyConfig();
        saveToFirebase();
    };
});

document.getElementById('save-personalize')?.addEventListener('click', () => {
    const lang = document.getElementById('system-language').value;
    systemConfig.language = lang;
    systemConfig.glassIntensity = parseInt(document.getElementById('glass-intensity').value) || 60;
    document.getElementById('glass-value').textContent = systemConfig.glassIntensity + '%';
    applyConfig();
    saveToFirebase();
    document.getElementById('personalize-modal').style.display = 'none';
    
    Swal.fire({
        title: 'Сохранено!',
        text: 'Настройки применены',
        icon: 'success',
        background: '#1a1a2e',
        color: '#fff',
        timer: 1500
    });
});

// Ползунок силы стекла
document.getElementById('glass-intensity')?.addEventListener('input', function() {
    document.getElementById('glass-value').textContent = this.value + '%';
});

document.querySelectorAll('.theme-option').forEach(opt => {
    opt.onclick = () => {
        document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        systemConfig.theme = opt.dataset.theme;
        applyConfig();
        saveToFirebase();
    };
});

// ========== КОНТЕКСТНОЕ МЕНЮ РАБОЧЕГО СТОЛА ==========
desktop?.addEventListener('contextmenu', (e) => {
    if (e.target === desktop || e.target.id === 'desktop-icons') {
        e.preventDefault();
        const menu = document.getElementById('context-menu');
        menu.style.left = Math.min(e.pageX, window.innerWidth - 220) + 'px';
        menu.style.top = Math.min(e.pageY, window.innerHeight - 300) + 'px';
        menu.style.display = 'flex';
    }
});

document.querySelectorAll('#context-menu .context-item').forEach(btn => {
    btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === 'personalize') {
            document.getElementById('personalize-modal').style.display = 'flex';
        }
        if (action === 'create-folder') {
            currentDesktopItems.push({ 
                id: Date.now() + Math.random(), 
                name: 'Новая папка', 
                type: 'folder', 
                children: [] 
            });
            renderDesktop();
            saveToFirebase();
        }
        if (action === 'create-file-txt') {
            currentDesktopItems.push({ 
                id: Date.now() + Math.random(), 
                name: 'новый.txt', 
                type: 'file', 
                content: '' 
            });
            renderDesktop();
            saveToFirebase();
        }
        if (action === 'create-file-doc') {
            currentDesktopItems.push({ 
                id: Date.now() + Math.random(), 
                name: 'новый.doc', 
                type: 'file', 
                content: '' 
            });
            renderDesktop();
            saveToFirebase();
        }
        if (action === 'refresh') {
            renderDesktop();
        }
        if (action === 'upload-wallpaper') {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    try {
                        const formData = new FormData();
                        formData.append('image', ev.target.result.split(',')[1]);
                        formData.append('key', IMGBB_KEY);
                        const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                        const json = await res.json();
                        if (json.success) {
                            systemConfig.wallpaper = json.data.url;
                            applyConfig();
                            saveToFirebase();
                            Swal.fire({
                                title: 'Успешно!',
                                text: 'Обои обновлены',
                                icon: 'success',
                                background: '#1a1a2e',
                                color: '#fff',
                                timer: 1500
                            });
                        }
                    } catch (err) {
                        console.error('Ошибка загрузки обоев:', err);
                    }
                };
                reader.readAsDataURL(file);
            };
            input.click();
        }
        document.getElementById('context-menu').style.display = 'none';
    };
});

// ========== СОХРАНЕНИЕ БЛОКНОТА ==========
document.getElementById('save-notepad')?.addEventListener('click', () => {
    const content = document.getElementById('notepad-content').value;
    if (window.currentFile) {
        window.currentFile.content = content;
        saveToFirebase();
        document.getElementById('notepad-status').textContent = 'Сохранено';
        setTimeout(() => {
            document.getElementById('notepad-status').textContent = 'Готово';
        }, 2000);
    }
});

// Ctrl+S для сохранения
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const notepad = document.getElementById('notepad-window');
        if (notepad.style.display !== 'none') {
            document.getElementById('save-notepad')?.click();
        }
    }
});

// Закрытие окон при потере фокуса
document.addEventListener('click', (e) => {
    if (!e.target.closest('.floating-window')) {
        // Можно добавить поведение
    }
});

console.log('✅ K-OS загружена!');
console.log('✨ Система полностью готова к работе!');

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
let currentStep = 1;
let setupData = {};
let clipboard = null;
let dragData = null;

const loadingScreen = document.getElementById('loading-screen');
const authScreen = document.getElementById('auth-screen');
const loginScreen = document.getElementById('login-screen');
const setupScreen = document.getElementById('setup-screen');
const desktop = document.getElementById('desktop');

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
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

// ========== СОХРАНЕНИЕ В FIREBASE (ЕЖЕСЕКУНДНО) ==========
async function saveToFirebase() {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    await setDoc(userRef, {
        desktopItems: currentDesktopItems,
        trashItems: trashItems,
        config: systemConfig
    }, { merge: true });
}

// АВТОСОХРАНЕНИЕ КАЖДУЮ СЕКУНДУ
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
        updateTrashIcon();
    } else {
        currentDesktopItems = [];
        renderDesktop();
    }
}

// ========== ПРИМЕНЕНИЕ НАСТРОЕК (ЖИДКОЕ СТЕКЛО) ==========
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
    
    // ЖИДКОЕ СТЕКЛО
    const intensity = systemConfig.glassIntensity || 60;
    const blurValue = 10 + (intensity / 100) * 40;
    const opacity = 0.25 + (intensity / 100) * 0.55;
    const borderRadius = 16 + (intensity / 100) * 12;
    
    document.querySelectorAll('.glass-panel').forEach(el => {
        el.style.backdropFilter = `blur(${blurValue}px) saturate(1.4)`;
        el.style.background = `rgba(30, 30, 40, ${opacity})`;
        el.style.borderRadius = borderRadius + 'px';
        el.style.border = `1px solid rgba(255, 255, 255, ${0.05 + (intensity / 100) * 0.15})`;
        el.style.boxShadow = `0 8px 32px rgba(0,0,0,${0.2 + (intensity / 100) * 0.4}), inset 0 1px 0 rgba(255,255,255,${0.05 + (intensity / 100) * 0.1})`;
    });
    
    document.querySelectorAll('.floating-window').forEach(el => {
        el.style.backdropFilter = `blur(${blurValue + 10}px) saturate(1.5)`;
        el.style.background = `rgba(30, 30, 40, ${opacity + 0.15})`;
        el.style.borderRadius = (borderRadius + 4) + 'px';
        el.style.border = `1px solid rgba(255, 255, 255, ${0.08 + (intensity / 100) * 0.12})`;
        el.style.boxShadow = `0 20px 60px rgba(0,0,0,${0.3 + (intensity / 100) * 0.5}), inset 0 1px 0 rgba(255,255,255,${0.05 + (intensity / 100) * 0.1})`;
    });
}

// ========== РЕНДЕР РАБОЧЕГО СТОЛА ==========
function renderDesktop() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    currentDesktopItems.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.setAttribute('data-id', item.id);
        
        // Иконка в зависимости от типа
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
            <div class="icon-label">${item.name}</div>
        `;
        
        // ДВОЙНОЙ КЛИК
        icon.ondblclick = () => {
            if (item.type === 'folder') openFolder(item);
            else openFile(item);
        };
        
        // ПКМ
        icon.oncontextmenu = (e) => {
            e.preventDefault();
            showFileContextMenu(e.pageX, e.pageY, item);
        };
        
        container.appendChild(icon);
    });
    updateTrashIcon();
}

// ========== НАСТРОЙКА (6 ШАГОВ) ==========
function renderSetupStep() {
    const stepContent = document.getElementById('setup-step-content');
    switch(currentStep) {
        case 1:
            stepContent.innerHTML = `<h2>Добро пожаловать в K-OS!</h2><p>Давайте настроим вашу систему</p>`;
            break;
        case 2:
            stepContent.innerHTML = `<h2>Выберите язык</h2>
                <select id="setup-lang" class="glass-select">
                    <option value="ru">Русский</option><option value="en">English</option>
                    <option value="es">Español</option><option value="zh">中文</option>
                </select>`;
            break;
        case 3:
            stepContent.innerHTML = `<h2>Яркость системы</h2><input type="range" id="setup-brightness" min="0" max="100" value="100">`;
            break;
        case 4:
            stepContent.innerHTML = `<h2>Подключение к Wi-Fi</h2><p>Пропустить (демо)</p>`;
            break;
        case 5:
            stepContent.innerHTML = `<h2>Установить пароль для входа</h2><input type="password" id="setup-password" class="glass-input" placeholder="Пароль">`;
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
    if (currentStep > 1) { currentStep--; renderSetupStep(); }
});

// ========== ОТКРЫТИЕ ПАПКИ (НОВОЕ) ==========
function openFolder(folder) {
    // Проверяем, открыто ли уже окно
    const existingWin = document.querySelector(`.folder-window[data-folder-id="${folder.id}"]`);
    if (existingWin) {
        existingWin.style.display = 'flex';
        existingWin.style.zIndex = '5000';
        return;
    }
    
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel folder-window';
    win.style.cssText = 'width: 600px; height: 400px; top: 15%; left: 20%; z-index: 5000; display: flex; flex-direction: column;';
    win.setAttribute('data-folder-id', folder.id);
    win.id = 'folder-window-' + Date.now();
    
    win.innerHTML = `
        <div class="window-header">
            <div class="window-title">
                <i class="fas fa-folder"></i>
                <span>${folder.name}</span>
            </div>
            <div class="window-controls">
                <button class="window-btn-min" data-win="${win.id}">─</button>
                <button class="window-btn-max" data-win="${win.id}">☐</button>
                <button class="window-btn-close" data-win="${win.id}">✕</button>
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
                <div class="folder-item" data-id="${child.id}" draggable="true">
                    <div class="folder-item-icon">${child.type === 'folder' ? '📁' : '📄'}</div>
                    <div class="folder-item-name">${child.name}</div>
                </div>
            `).join('') || '<div class="folder-empty">Папка пуста</div>'}
        </div>
    `;
    
    document.body.appendChild(win);
    makeDraggable(win);
    
    // Кнопки окна
    win.querySelectorAll('.window-btn-min, .window-btn-max, .window-btn-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const winId = btn.dataset.win;
            const action = btn.className.includes('min') ? 'minimize' : 
                          btn.className.includes('max') ? 'maximize' : 'close';
            if (action === 'minimize') minimizeWindow(winId);
            else if (action === 'maximize') toggleMaximize(winId);
            else if (action === 'close') closeWindow(winId);
        });
    });
    
    // DROP В ПАПКУ
    const content = win.querySelector('.folder-content');
    content.addEventListener('dragover', (e) => e.preventDefault());
    content.addEventListener('drop', (e) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            // Файлы с компьютера в папку
            handleFileDrop(files, folder);
            return;
        }
        
        if (dragData) {
            const item = dragData.item;
            if (item && item.id !== folder.id) {
                // Удаляем с рабочего стола
                currentDesktopItems = currentDesktopItems.filter(i => i.id !== item.id);
                if (!folder.children) folder.children = [];
                // Проверяем дубликаты
                const exists = folder.children.find(c => c.id === item.id);
                if (!exists) {
                    folder.children.push({...item});
                }
                renderDesktop();
                refreshFolderWindow(folder.id);
                saveToFirebase();
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
                        <div class="folder-item" data-id="${child.id}" draggable="true">
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

// ========== ОТКРЫТИЕ ФАЙЛА (НОВОЕ ОКНО) ==========
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

// ========== КОНТЕКСТНОЕ МЕНЮ ФАЙЛА ==========
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

// ========== КОРЗИНА (КАК В ВИНДОВС) ==========
function updateTrashIcon() {
    const trashIcon = document.getElementById('trash');
    if (trashIcon) {
        const count = trashItems.length;
        const label = trashIcon.querySelector('.icon-label');
        if (label) {
            label.textContent = count > 0 ? `Корзина (${count})` : 'Корзина';
        }
        trashIcon.style.opacity = count > 0 ? '1' : '0.5';
    }
}

document.getElementById('trash')?.addEventListener('dblclick', () => {
    openTrash();
});

document.getElementById('trash')?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    openTrash();
});

function openTrash() {
    const modal = document.getElementById('trash-modal');
    const content = document.getElementById('trash-content');
    if (!modal || !content) return;
    
    if (trashItems.length === 0) {
        content.innerHTML = '<div class="trash-empty">Корзина пуста</div>';
    } else {
        content.innerHTML = trashItems.map((item, index) => `
            <div class="trash-item">
                <span>${item.type === 'folder' ? '📁' : '📄'} ${item.name}</span>
                <div class="trash-actions">
                    <button onclick="window.restoreItem(${index})" class="window-btn">Восстановить</button>
                    <button onclick="window.deletePermanently(${index})" class="window-btn" style="background: rgba(255,0,0,0.3);">Удалить</button>
                </div>
            </div>
        `).join('');
    }
    
    modal.style.display = 'flex';
}

function closeTrash() {
    document.getElementById('trash-modal').style.display = 'none';
}

window.restoreItem = function(index) {
    const item = trashItems[index];
    if (item) {
        currentDesktopItems.push({...item});
        trashItems.splice(index, 1);
        renderDesktop();
        saveToFirebase();
        openTrash();
        updateTrashIcon();
    }
};

window.deletePermanently = function(index) {
    trashItems.splice(index, 1);
    renderDesktop();
    saveToFirebase();
    openTrash();
    updateTrashIcon();
};

window.emptyTrash = function() {
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
};

// ========== УПРАВЛЕНИЕ ОКНАМИ ==========
function minimizeWindow(id) {
    const win = document.getElementById(id);
    if (win) {
        if (win.dataset.minimized === 'true') {
            win.style.display = 'flex';
            win.dataset.minimized = 'false';
        } else {
            win.style.display = 'none';
            win.dataset.minimized = 'true';
        }
    }
}

function toggleMaximize(id) {
    const win = document.getElementById(id);
    if (!win) return;
    
    if (win.dataset.maximized === 'true') {
        win.style.width = win.dataset.oldWidth || '50%';
        win.style.height = win.dataset.oldHeight || '60%';
        win.style.left = win.dataset.oldLeft || '20%';
        win.style.top = win.dataset.oldTop || '15%';
        win.dataset.maximized = 'false';
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
    }
}

function closeWindow(id) {
    const win = document.getElementById(id);
    if (win) {
        if (win.id === 'notepad-window' || win.id === 'viewer-window') {
            win.style.display = 'none';
        } else {
            win.remove();
        }
    }
}

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
        windowElement.style.zIndex = '9999';
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

// ========== ОБРАБОТЧИКИ КНОПОК ОКОН ==========
document.querySelectorAll('.window-btn-min, .window-btn-max, .window-btn-close').forEach(btn => {
    btn.addEventListener('click', () => {
        const winId = btn.dataset.win;
        if (!winId) return;
        const action = btn.className.includes('min') ? 'minimize' : 
                      btn.className.includes('max') ? 'maximize' : 'close';
        if (action === 'minimize') minimizeWindow(winId);
        else if (action === 'maximize') toggleMaximize(winId);
        else if (action === 'close') closeWindow(winId);
    });
});

// ========== DRAG & DROP ФАЙЛОВ С КОМПЬЮТЕРА (ОДИН ФАЙЛ) ==========
async function handleFileDrop(files, targetFolder = null) {
    if (!files || files.length === 0) return;
    
    // Берем ТОЛЬКО ПЕРВЫЙ файл
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
            
            const newFile = {
                id: Date.now() + Math.random(),
                name: file.name,
                type: type,
                content: content,
                url: url
            };
            
            if (targetFolder) {
                // В папку
                if (!targetFolder.children) targetFolder.children = [];
                targetFolder.children.push(newFile);
                refreshFolderWindow(targetFolder.id);
            } else {
                // На рабочий стол - проверяем дубликаты
                const existing = currentDesktopItems.find(i => i.name === file.name);
                if (existing) {
                    Swal.fire({
                        title: 'Файл уже существует',
                        text: `Файл "${file.name}" уже есть`,
                        icon: 'warning',
                        background: '#1a1a2e',
                        color: '#fff'
                    });
                    return;
                }
                currentDesktopItems.push(newFile);
                renderDesktop();
            }
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
}

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    
    const target = e.target.closest('#desktop') || e.target.closest('#desktop-icons');
    if (!target) return;
    
    await handleFileDrop(files);
});

// ========== АВТОРИЗАЦИЯ ==========
document.getElementById('do-login')?.addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch(e) { Swal.fire('Ошибка', e.message, 'error'); }
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
        Swal.fire('Успешно!', 'Аккаунт создан', 'success');
    } catch(e) { Swal.fire('Ошибка', e.message, 'error'); }
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
        renderDesktop();
    } else {
        Swal.fire('Ошибка', 'Неверный пароль', 'error');
    }
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
            currentStep = 1;
            showScreen(authScreen);
            renderSetupStep();
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

// ========== ПЕРСОНАЛИЗАЦИЯ (НОВОЕ) ==========
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

document.getElementById('glass-intensity')?.addEventListener('input', function() {
    document.getElementById('glass-value').textContent = this.value + '%';
    // Предпросмотр
    const temp = systemConfig.glassIntensity;
    systemConfig.glassIntensity = parseInt(this.value);
    applyConfig();
    systemConfig.glassIntensity = temp;
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
                    } catch (err) { console.error(err); }
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

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const notepad = document.getElementById('notepad-window');
        if (notepad && notepad.style.display !== 'none') {
            document.getElementById('save-notepad')?.click();
        }
    }
});

console.log('✅ K-OS загружена!');
console.log('✨ Система полностью готова к работе!');

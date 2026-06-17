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
let systemConfig = { wallpaper: 'https://i.ibb.co/tgktvGq/image.png', language: 'ru', theme: 'dark', password: null };
let currentStep = 1;
let setupData = {};

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
    [authScreen, loginScreen, setupScreen, desktop].forEach(s => {
        if (s) s.style.display = 'none';
    });
    screen.style.display = 'block';
}

async function saveToFirebase() {
    if (!currentUser) return;
    const userRef = doc(db, 'users', currentUser.uid);
    await setDoc(userRef, {
        desktopItems: currentDesktopItems,
        trashItems: trashItems,
        config: systemConfig
    }, { merge: true });
}

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

function applyConfig() {
    desktop.style.backgroundImage = `url(${systemConfig.wallpaper})`;
    document.body.style.background = systemConfig.theme === 'dark' ? '#0a0a0a' : '#f0f0f0';
}

function renderDesktop() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    currentDesktopItems.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.setAttribute('data-id', item.id);
        icon.innerHTML = `
            <div class="icon-img">${item.type === 'folder' ? '<i class="fas fa-folder"></i>' : '<i class="fas fa-file"></i>'}</div>
            <div class="icon-label">${item.name}</div>
        `;
        icon.onclick = () => {
            if (item.type === 'folder') openFolder(item);
            else openFile(item);
        };
        icon.oncontextmenu = (e) => {
            e.preventDefault();
            showFileContextMenu(e.pageX, e.pageY, item);
        };
        container.appendChild(icon);
    });
}

function openFolder(folder) {
    Swal.fire({ title: folder.name, text: 'Папка открыта (демо)', background: '#1a1a2e', color: '#fff' });
}

function openFile(file) {
    if (file.name.endsWith('.txt') || file.name.endsWith('.doc')) {
        const window = document.getElementById('notepad-window');
        window.style.display = 'block';
        document.getElementById('notepad-content').value = file.content || '';
        window.currentFile = file;
    } else if (file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
        const window = document.getElementById('viewer-window');
        window.style.display = 'block';
        document.getElementById('viewer-image').src = file.content || file.path || '';
    }
}

function showFileContextMenu(x, y, item) {
    const menu = document.getElementById('file-context-menu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'flex';
    window.selectedFile = item;
    
    document.querySelectorAll('#file-context-menu .context-item').forEach(btn => {
        btn.onclick = () => {
            const action = btn.dataset.action;
            if (action === 'rename') {
                const newName = prompt('Новое имя:', item.name);
                if (newName) { item.name = newName; renderDesktop(); saveToFirebase(); }
            } else if (action === 'delete') {
                trashItems.push(item);
                currentDesktopItems = currentDesktopItems.filter(i => i.id !== item.id);
                renderDesktop(); saveToFirebase();
            } else if (action === 'open') openFile(item);
            menu.style.display = 'none';
        };
    });
}

// ========== НАСТРОЙКА ==========
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
    if (pwd === systemConfig.password) showScreen(desktop);
    else Swal.fire('Ошибка', 'Неверный пароль', 'error');
});

document.getElementById('logout-full')?.addEventListener('click', () => signOut(auth));

// ========== DRAG & DROP ==========
document.body.addEventListener('dragover', (e) => e.preventDefault());
document.body.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    for (let file of files) {
        const reader = new FileReader();
        reader.onload = async (event) => {
            let content = event.target.result;
            if (file.type.startsWith('image/')) {
                const formData = new FormData();
                formData.append('image', content.split(',')[1]);
                formData.append('key', IMGBB_KEY);
                const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: formData });
                const json = await res.json();
                if (json.success) content = json.data.url;
            }
            currentDesktopItems.push({ id: Date.now(), name: file.name, type: 'file', content: content });
            renderDesktop();
            saveToFirebase();
        };
        reader.readAsDataURL(file);
    }
});

// ========== МЕНЮ ПУСК ==========
document.getElementById('start-button')?.addEventListener('click', () => {
    const menu = document.getElementById('start-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
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
    };
});
document.getElementById('save-personalize')?.addEventListener('click', () => {
    const lang = document.getElementById('system-language').value;
    systemConfig.language = lang;
    saveToFirebase();
    document.getElementById('personalize-modal').style.display = 'none';
});
document.querySelectorAll('.theme-option').forEach(opt => {
    opt.onclick = () => {
        document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
        systemConfig.theme = opt.dataset.theme;
        applyConfig();
    };
});

// ========== ЗАКРЫТИЕ ОКОН ==========
document.querySelectorAll('.close-window').forEach(btn => {
    btn.onclick = () => {
        document.getElementById('notepad-window').style.display = 'none';
        document.getElementById('viewer-window').style.display = 'none';
    };
});
document.getElementById('save-notepad')?.addEventListener('click', () => {
    const win = document.getElementById('notepad-window');
    if (win.currentFile) {
        win.currentFile.content = document.getElementById('notepad-content').value;
        saveToFirebase();
    }
    win.style.display = 'none';
});

// ========== КЛИК ВНЕ МЕНЮ ==========
document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu')) {
        document.getElementById('context-menu').style.display = 'none';
        document.getElementById('file-context-menu').style.display = 'none';
    }
    if (!e.target.closest('#start-button') && !e.target.closest('#start-menu')) {
        document.getElementById('start-menu').style.display = 'none';
    }
});

// ========== КОНТЕКСТНОЕ МЕНЮ РАБОЧЕГО СТОЛА ==========
desktop?.addEventListener('contextmenu', (e) => {
    if (e.target === desktop || e.target.id === 'desktop-icons') {
        e.preventDefault();
        const menu = document.getElementById('context-menu');
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        menu.style.display = 'flex';
    }
});
document.querySelectorAll('#context-menu .context-item').forEach(btn => {
    btn.onclick = () => {
        const action = btn.dataset.action;
        if (action === 'personalize') document.getElementById('personalize-modal').style.display = 'flex';
        if (action === 'create-folder') {
            currentDesktopItems.push({ id: Date.now(), name: 'Новая папка', type: 'folder', children: [] });
            renderDesktop(); saveToFirebase();
        }
        if (action === 'create-file-txt') {
            currentDesktopItems.push({ id: Date.now(), name: 'новый.txt', type: 'file', content: '' });
            renderDesktop(); saveToFirebase();
        }
        if (action === 'create-file-doc') {
            currentDesktopItems.push({ id: Date.now(), name: 'новый.doc', type: 'file', content: '' });
            renderDesktop(); saveToFirebase();
        }
        document.getElementById('context-menu').style.display = 'none';
    };
});

// ========== AUTH STATE ==========
onAuthStateChanged(auth, async (user) => {
    console.log("Auth state changed:", user ? "Пользователь есть" : "Нет пользователя");
    
    try {
        if (user) {
            console.log("Загрузка данных пользователя...");
            currentUser = user;
            await loadFromFirebase();
            console.log("Данные загружены, config:", systemConfig);
            
            if (systemConfig.password) {
                console.log("Показываем экран входа с паролем");
                showScreen(loginScreen);
            } else {
                console.log("Показываем рабочий стол");
                showScreen(desktop);
            }
        } else {
            console.log("Нет пользователя, показываем экран авторизации");
            currentStep = 1;
            showScreen(authScreen);
            if (typeof renderSetupStep === 'function') {
                renderSetupStep();
            }
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
        console.log("Скрываем загрузку");
        showLoading(false);
    }
});
document.getElementById('setup-next')?.addEventListener('click', nextSetupStep);
document.getElementById('setup-prev')?.addEventListener('click', () => {
    if (currentStep > 1) { currentStep--; renderSetupStep(); }
});
// ========== ДОБАВЛЯЕМ ПЕРЕТАСКИВАНИЕ ИКОНОК ==========
let draggedItem = null;
let dragOffsetX = 0;
let dragOffsetY = 0;

document.addEventListener('dragstart', (e) => {
    const icon = e.target.closest('.desktop-icon');
    if (!icon) return;
    const id = icon.dataset.id;
    draggedItem = currentDesktopItems.find(item => item.id == id);
    if (draggedItem) {
        e.dataTransfer.setData('text/plain', id);
        icon.style.opacity = '0.5';
    }
});

document.addEventListener('dragend', (e) => {
    const icon = e.target.closest('.desktop-icon');
    if (icon) icon.style.opacity = '1';
});

document.getElementById('desktop-icons').addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.getElementById('desktop-icons').addEventListener('drop', (e) => {
    e.preventDefault();
    if (!draggedItem) return;
    
    const container = document.getElementById('desktop-icons');
    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    draggedItem.x = Math.max(0, x);
    draggedItem.y = Math.max(0, y);
    
    saveToFirebase();
    renderDesktop();
    draggedItem = null;
});

// ========== ЗАГРУЗКА СВОИХ ОБОЕВ ==========
document.querySelector('[data-action="upload-wallpaper"]')?.addEventListener('click', () => {
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
    document.getElementById('context-menu').style.display = 'none';
});

// ========== ПРИВЕТСТВИЕ (HELLO) ==========
async function showGreeting() {
    const lang = navigator.language || 'ru';
    const isRussian = lang.startsWith('ru');
    const greeting = isRussian ? 'Привет' : 'Hello';
    
    const greetingScreen = document.getElementById('greeting-screen');
    if (!greetingScreen) {
        // Создаём экран приветствия если его нет
        const div = document.createElement('div');
        div.id = 'greeting-screen';
        div.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: linear-gradient(135deg, #0f0c29, #302b63);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 5000;
        `;
        div.innerHTML = `<div class="greeting-text" style="font-size: 80px; font-weight: 700; color: white; animation: fadeInScale 0.5s ease;">${greeting}</div>`;
        document.body.appendChild(div);
    }
    
    const screen = document.getElementById('greeting-screen');
    screen.style.display = 'flex';
    await new Promise(r => setTimeout(r, 1500));
    screen.style.display = 'none';
}

// ========== ПРАВИЛЬНЫЙ ПОКАЗ ОБОЕВ (cover) ==========
// Убедимся что applyConfig использует cover
const originalApplyConfig = applyConfig;
applyConfig = function() {
    if (desktop) {
        desktop.style.backgroundImage = `url(${systemConfig.wallpaper})`;
        desktop.style.backgroundSize = 'cover';
        desktop.style.backgroundPosition = 'center';
        desktop.style.backgroundRepeat = 'no-repeat';
    }
    if (originalApplyConfig) originalApplyConfig();
};

// ========== DRAG & DROP ФАЙЛОВ С КОМПЬЮТЕРА ==========
document.addEventListener('dragover', (e) => {
    e.preventDefault();
});

document.addEventListener('drop', async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    
    // Проверяем что файлы брошены на рабочий стол
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
                console.error('Ошибка загрузки файла:', err);
            }
        };
        reader.readAsDataURL(file);
    }
});

// ========== ДОБАВЛЯЕМ ПУНКТ "ЗАГРУЗИТЬ СВОИ ОБОИ" В КОНТЕКСТНОЕ МЕНЮ ==========
// Добавляем пункт в меню если его нет
document.addEventListener('DOMContentLoaded', () => {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu) {
        const existing = contextMenu.querySelector('[data-action="upload-wallpaper"]');
        if (!existing) {
            const item = document.createElement('div');
            item.className = 'context-item';
            item.dataset.action = 'upload-wallpaper';
            item.innerHTML = '<i class="fas fa-image"></i> Загрузить свои обои';
            contextMenu.appendChild(item);
        }
    }
});

// ========== ОБНОВЛЯЕМ РЕНДЕР ДЕСКТОПА С УЧЁТОМ ПОЗИЦИЙ ==========
const originalRenderDesktop = renderDesktop;
renderDesktop = function() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    
    currentDesktopItems.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.setAttribute('data-id', item.id);
        icon.setAttribute('draggable', 'true');
        
        // Применяем позицию если есть
        if (item.x !== undefined && item.y !== undefined) {
            icon.style.position = 'absolute';
            icon.style.left = item.x + 'px';
            icon.style.top = item.y + 'px';
        }
        
        icon.innerHTML = `
            <div class="icon-img">${item.type === 'folder' ? '<i class="fas fa-folder"></i>' : '<i class="fas fa-file"></i>'}</div>
            <div class="icon-label">${item.name}</div>
        `;
        
        icon.onclick = () => {
            if (item.type === 'folder') {
                Swal.fire({
                    title: item.name,
                    text: 'Папка открыта (демо)',
                    background: '#1a1a2e',
                    color: '#fff'
                });
            } else {
                openFile(item);
            }
        };
        
        icon.oncontextmenu = (e) => {
            e.preventDefault();
            showFileContextMenu(e.pageX, e.pageY, item);
        };
        
        container.appendChild(icon);
    });
    
    if (originalRenderDesktop) originalRenderDesktop();
};

console.log('✅ K-OS обновлён с новыми функциями!');
console.log('✨ K-OS загружена!');

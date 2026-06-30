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
    password: null 
};
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
    const screens = [authScreen, loginScreen, setupScreen, desktop];
    screens.forEach(s => {
        if (s) s.style.display = 'none';
    });
    if (screen) {
        screen.style.display = 'flex';
        
        // Если показываем рабочий стол — запускаем анимацию
        if (screen === desktop) {
            // Убираем blur у всех элементов кроме фона
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

function showScreen(screen) {
    const screens = [authScreen, loginScreen, setupScreen, desktop];
    screens.forEach(s => {
        if (s) s.style.display = 'none';
    });
    if (screen) {
        screen.style.display = 'flex';
        
        // Если показываем рабочий стол — запускаем анимацию
        if (screen === desktop) {
            // Убираем blur у всех элементов кроме фона
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
    // Если это картинка
    if (file.url || file.content) {
        const win = document.getElementById('viewer-window');
        win.style.display = 'flex';
        win.style.left = '20%';
        win.style.top = '15%';
        document.getElementById('viewer-image').src = file.url || file.content;
        return;
    }
    
    // Если это текстовый файл
    if (file.name.endsWith('.txt') || file.name.endsWith('.doc')) {
        const win = document.getElementById('notepad-window');
        win.style.display = 'flex';
        win.style.left = '25%';
        win.style.top = '20%';
        document.getElementById('notepad-content').value = file.content || '';
        window.currentFile = file;
        return;
    }
    
    alert('Не могу открыть этот файл');
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
// ========== КОНСТРУКТОР ПРИЛОЖЕНИЙ ==========
let installedApps = JSON.parse(localStorage.getItem('k-os-apps') || '[]');

function saveInstalledApps() {
    localStorage.setItem('k-os-apps', JSON.stringify(installedApps));
}

// Добавляем кнопку "Создать приложение" в меню Пуск
document.addEventListener('DOMContentLoaded', () => {
    const appList = document.querySelector('.app-list');
    if (appList) {
        const createAppBtn = document.createElement('div');
        createAppBtn.className = 'app-item';
        createAppBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Создать приложение';
        createAppBtn.onclick = () => {
            document.getElementById('app-builder').style.display = 'flex';
            document.getElementById('start-menu').style.display = 'none';
        };
        appList.appendChild(createAppBtn);
        
        const installedBtn = document.createElement('div');
        installedBtn.className = 'app-item';
        installedBtn.innerHTML = '<i class="fas fa-th"></i> Мои приложения';
        installedBtn.onclick = () => {
            showInstalledApps();
            document.getElementById('start-menu').style.display = 'none';
        };
        appList.appendChild(installedBtn);
    }
});

// Сборка .ky файла
document.getElementById('build-app-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('app-name').value || 'my-app';
    const desc = document.getElementById('app-desc').value || 'Моё приложение';
    const icon = document.getElementById('app-icon').value || 'https://i.ibb.co/20StnqXy/image.png';
    const code = document.getElementById('app-code').value || '<h1>Hello World</h1>';
    const css = document.getElementById('app-css').value || '';

    // Создаём манифест
    const manifest = {
        name: name,
        description: desc,
        icon: icon,
        version: '1.0.0',
        type: 'web',
        created: new Date().toISOString()
    };

    // Создаём HTML файл с кодом
    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${name}</title>
    <style>${css}</style>
</head>
<body>
    ${code}
</body>
</html>`;

    // Создаём ZIP вручную через JSZip
    try {
        const zip = new JSZip();
        zip.file('manifest.json', JSON.stringify(manifest, null, 2));
        zip.file('code/index.html', html);
        if (icon.startsWith('http')) {
            // Скачиваем иконку
            const response = await fetch(icon);
            const blob = await response.blob();
            zip.file('icon.png', blob);
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${name.toLowerCase().replace(/ /g, '_')}.ky`;
        link.click();
        URL.revokeObjectURL(link.href);

        Swal.fire({
            title: 'Готово!',
            text: `Приложение "${name}" собрано в .ky файл`,
            icon: 'success',
            background: '#1a1a2e',
            color: '#fff'
        });
    } catch (error) {
        console.error('Ошибка сборки:', error);
        Swal.fire({
            title: 'Ошибка',
            text: 'Не удалось собрать приложение: ' + error.message,
            icon: 'error',
            background: '#1a1a2e',
            color: '#fff'
        });
    }
});

// Тестирование приложения
document.getElementById('test-app-btn')?.addEventListener('click', () => {
    const name = document.getElementById('app-name').value || 'Тест';
    const code = document.getElementById('app-code').value || '<h1>Hello World</h1>';
    const css = document.getElementById('app-css').value || '';
    
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel';
    win.style.cssText = 'width: 600px; height: 400px; top: 15%; left: 25%; z-index: 5000; display: flex; flex-direction: column;';
    win.innerHTML = `
        <div class="window-header">
            <span>🧪 Тест: ${name}</span>
            <button class="close-window" onclick="this.closest('.floating-window').remove()">✖</button>
        </div>
        <div style="flex: 1; overflow: auto; padding: 20px; background: rgba(0,0,0,0.3);">
            <style>${css}</style>
            ${code}
        </div>
    `;
    document.body.appendChild(win);
});

// Установка .ky файла (перетаскивание)
document.addEventListener('drop', async (e) => {
    const files = e.dataTransfer.files;
    for (let file of files) {
        if (file.name.endsWith('.ky')) {
            e.preventDefault();
            try {
                const zip = await JSZip.loadAsync(file);
                const manifestFile = zip.file('manifest.json');
                if (!manifestFile) {
                    throw new Error('Не найден manifest.json');
                }
                const manifest = JSON.parse(await manifestFile.async('text'));
                const htmlFile = zip.file('code/index.html');
                const html = htmlFile ? await htmlFile.async('text') : '<h1>Нет кода</h1>';
                
                // Устанавливаем приложение
                installedApps.push({
                    id: Date.now(),
                    name: manifest.name,
                    description: manifest.description,
                    icon: manifest.icon || 'https://i.ibb.co/20StnqXy/image.png',
                    code: html,
                    installed: new Date().toISOString()
                });
                saveInstalledApps();
                
                Swal.fire({
                    title: 'Установлено!',
                    text: `Приложение "${manifest.name}" установлено`,
                    icon: 'success',
                    background: '#1a1a2e',
                    color: '#fff'
                });
                
                renderInstalledApps();
            } catch (error) {
                console.error('Ошибка установки:', error);
                Swal.fire({
                    title: 'Ошибка',
                    text: 'Не удалось установить приложение: ' + error.message,
                    icon: 'error',
                    background: '#1a1a2e',
                    color: '#fff'
                });
            }
        }
    }
});

// Показать установленные приложения
function showInstalledApps() {
    const modal = document.getElementById('installed-apps-modal');
    const list = document.getElementById('installed-apps-list');
    if (!list) return;
    
    if (installedApps.length === 0) {
        list.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 40px;">Нет установленных приложений</p>';
    } else {
        list.innerHTML = installedApps.map(app => `
            <div style="display: flex; align-items: center; gap: 12px; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 12px; margin-bottom: 8px;">
                <img src="${app.icon}" style="width: 36px; height: 36px; border-radius: 8px;" onerror="this.src='https://i.ibb.co/20StnqXy/image.png'">
                <div style="flex: 1;">
                    <div style="font-weight: 600;">${app.name}</div>
                    <div style="font-size: 12px; opacity: 0.6;">${app.description || 'Без описания'}</div>
                </div>
                <button onclick="launchApp(${app.id})" class="auth-btn" style="width: auto; padding: 6px 16px; background: rgba(102,126,234,0.6);">Запустить</button>
                <button onclick="uninstallApp(${app.id})" class="auth-btn" style="width: auto; padding: 6px 12px; background: rgba(255,0,0,0.3);">🗑️</button>
            </div>
        `).join('');
    }
    
    modal.style.display = 'flex';
}

function renderInstalledApps() {
    // Обновляем список в меню Пуск
    const recentApps = document.getElementById('recent-apps');
    if (recentApps) {
        const recent = installedApps.slice(-3).map(app => `
            <div class="app-item installed-app" onclick="launchApp(${app.id})">
                <img src="${app.icon}" onerror="this.src='https://i.ibb.co/20StnqXy/image.png'" style="width: 20px; height: 20px; border-radius: 4px;">
                ${app.name}
            </div>
        `).join('');
        recentApps.innerHTML = recent || '<div style="opacity: 0.5; font-size: 13px;">Нет недавних</div>';
    }
}

// Запуск приложения
window.launchApp = function(id) {
    const app = installedApps.find(a => a.id === id);
    if (!app) return;
    
    const win = document.createElement('div');
    win.className = 'floating-window glass-panel';
    win.style.cssText = 'width: 700px; height: 500px; top: 10%; left: 20%; z-index: 5000; display: flex; flex-direction: column;';
    win.innerHTML = `
        <div class="window-header">
            <span><img src="${app.icon}" style="width: 20px; height: 20px; border-radius: 4px; margin-right: 8px;" onerror="this.style.display='none'"> ${app.name}</span>
            <button class="close-window" onclick="this.closest('.floating-window').remove()">✖</button>
        </div>
        <div style="flex: 1; overflow: auto; padding: 0; background: rgba(0,0,0,0.3);">
            ${app.code}
        </div>
    `;
    document.body.appendChild(win);
};

// Удаление приложения
window.uninstallApp = function(id) {
    Swal.fire({
        title: 'Удалить приложение?',
        text: 'Это действие нельзя отменить',
        icon: 'warning',
        background: '#1a1a2e',
        color: '#fff',
        showCancelButton: true,
        confirmButtonText: 'Удалить',
        cancelButtonText: 'Отмена'
    }).then(result => {
        if (result.isConfirmed) {
            installedApps = installedApps.filter(a => a.id !== id);
            saveInstalledApps();
            showInstalledApps();
            renderInstalledApps();
        }
    });
};

// Добавляем установленные приложения в меню Пуск
setTimeout(renderInstalledApps, 1000);
// ========== ЗАГРУЗЧИК ИЗОБРАЖЕНИЙ ==========
let loaderImageCount = 0;
let isLoaderMinimized = false;

function showLoader(filename = '') {
    const loader = document.getElementById('image-loader');
    if (!loader) return;
    
    loader.style.display = 'flex';
    document.getElementById('loader-progress-text').textContent = '0%';
    document.getElementById('loader-bar').style.width = '0%';
    document.getElementById('loader-status').textContent = 'Начинаем загрузку...';
    document.getElementById('loader-title').textContent = filename ? `Загрузка: ${filename}` : 'Загрузка изображения';
    document.getElementById('loader-filename').textContent = filename || 'Обработка...';
    
    isLoaderMinimized = false;
    loader.classList.remove('minimized');
}

function updateLoader(progress, status = '') {
    const progressText = document.getElementById('loader-progress-text');
    const bar = document.getElementById('loader-bar');
    const statusEl = document.getElementById('loader-status');
    
    if (progressText) progressText.textContent = Math.round(progress) + '%';
    if (bar) bar.style.width = Math.min(100, progress) + '%';
    if (statusEl && status) statusEl.textContent = status;
}

function closeLoader() {
    const loader = document.getElementById('image-loader');
    if (loader) {
        loader.style.display = 'none';
        loader.classList.remove('minimized');
    }
}

function minimizeLoader() {
    const loader = document.getElementById('image-loader');
    if (!loader) return;
    
    isLoaderMinimized = !isLoaderMinimized;
    if (isLoaderMinimized) {
        loader.classList.add('minimized');
        // Меняем заголовок на маленький
        document.getElementById('loader-title').textContent = '📷 ' + document.getElementById('loader-filename').textContent;
    } else {
        loader.classList.remove('minimized');
        document.getElementById('loader-title').textContent = 'Загрузка изображения';
    }
}

// ========== ПЕРЕТАСКИВАНИЕ ЗАГРУЗЧИКА ==========
document.addEventListener('DOMContentLoaded', () => {
    const loader = document.getElementById('image-loader');
    if (!loader) return;
    
    let isDragging = false;
    let offsetX, offsetY;
    
    loader.querySelector('.window-header').addEventListener('mousedown', (e) => {
        if (e.target.closest('.close-window') || e.target.closest('.window-minimize')) return;
        isDragging = true;
        const rect = loader.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        loader.style.transform = 'none';
        loader.style.left = rect.left + 'px';
        loader.style.top = rect.top + 'px';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        loader.style.left = (e.clientX - offsetX) + 'px';
        loader.style.top = (e.clientY - offsetY) + 'px';
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
});

// ========== НОВАЯ ФУНКЦИЯ ДЛЯ ЗАГРУЗКИ ИЗОБРАЖЕНИЙ ==========
async function uploadImageWithLoader(file) {
    return new Promise((resolve, reject) => {
        // Считаем сколько уже загружено
        let count = parseInt(localStorage.getItem('k-os-image-count') || '0');
        count++;
        localStorage.setItem('k-os-image-count', String(count));
        const imageName = count === 1 ? 'изображение' : `изображение(${count})`;
        
        // Показываем окошко
        document.getElementById('image-loader').style.display = 'block';
        document.getElementById('loader-progress-text').textContent = '0%';
        document.getElementById('loader-bar').style.width = '0%';
        document.getElementById('loader-status').textContent = 'Подготовка...';
        document.getElementById('loader-filename').textContent = imageName;
        
        const reader = new FileReader();
        reader.onload = async (event) => {
            try {
                document.getElementById('loader-status').textContent = 'Загрузка...';
                document.getElementById('loader-progress-text').textContent = '50%';
                document.getElementById('loader-bar').style.width = '50%';
                
                const formData = new FormData();
                formData.append('image', event.target.result.split(',')[1]);
                formData.append('key', IMGBB_KEY);
                
                const res = await fetch('https://api.imgbb.com/1/upload', {
                    method: 'POST',
                    body: formData
                });
                
                document.getElementById('loader-progress-text').textContent = '80%';
                document.getElementById('loader-bar').style.width = '80%';
                document.getElementById('loader-status').textContent = 'Сохранение...';
                
                const json = await res.json();
                
                if (json.success) {
                    document.getElementById('loader-progress-text').textContent = '100%';
                    document.getElementById('loader-bar').style.width = '100%';
                    document.getElementById('loader-status').textContent = 'Готово!';
                    
                    setTimeout(() => {
                        document.getElementById('image-loader').style.display = 'none';
                    }, 500);
                    
                    resolve({
                        url: json.data.url,
                        name: imageName,
                        originalName: file.name
                    });
                } else {
                    reject(new Error('Ошибка загрузки'));
                }
            } catch (error) {
                reject(error);
            }
        };
        reader.readAsDataURL(file);
    });
}

// ========== ПЕРЕХВАТ DRAG & DROP ДЛЯ ЗАГРУЗЧИКА ==========
// Переопределяем обработку drop для изображений
const originalDropHandler = document.body.ondrop;
document.body.ondrop = async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;
    
    const target = e.target.closest('#desktop') || e.target.closest('#desktop-icons');
    if (!target) return;
    
    for (let file of files) {
        if (file.type.startsWith('image/')) {
            try {
                // Загружаем с красивым загрузчиком
                const result = await uploadImageWithLoader(file);
                currentDesktopItems.push({
                    id: Date.now() + Math.random(),
                    name: result.name, // Теперь имя: "изображение", "изображение(1)" и т.д.
                    type: 'file',
                    content: result.url,
                    url: result.url,
                    originalName: result.fullName
                });
                renderDesktop();
                saveToFirebase();
            } catch (error) {
                console.error('Ошибка загрузки:', error);
                Swal.fire({
                    title: 'Ошибка',
                    text: 'Не удалось загрузить изображение',
                    icon: 'error',
                    background: '#1a1a2e',
                    color: '#fff'
                });
                closeLoader();
            }
        } else {
            // Для не-изображений используем старый метод
            const reader = new FileReader();
            reader.onload = async (event) => {
                let content = event.target.result;
                currentDesktopItems.push({
                    id: Date.now() + Math.random(),
                    name: file.name,
                    type: 'file',
                    content: content
                });
                renderDesktop();
                saveToFirebase();
            };
            reader.readAsDataURL(file);
        }
    }
};

// ========== ЗАГРУЗКА ОБОЕВ ЧЕРЕЗ ЗАГРУЗЧИК ==========
// Переопределяем загрузку обоев
document.querySelector('[data-action="upload-wallpaper"]')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const result = await uploadImageWithLoader(file);
            systemConfig.wallpaper = result.url;
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
        } catch (error) {
            console.error('Ошибка загрузки обоев:', error);
            Swal.fire({
                title: 'Ошибка',
                text: 'Не удалось загрузить обои',
                icon: 'error',
                background: '#1a1a2e',
                color: '#fff'
            });
            closeLoader();
        }
    };
    input.click();
    document.getElementById('context-menu').style.display = 'none';
});

// ========== ОБНОВЛЯЕМ РЕНДЕР ДЕСКТОПА (показываем оригинальное имя в подсказке) ==========
const oldRenderDesktop = renderDesktop;
renderDesktop = function() {
    const container = document.getElementById('desktop-icons');
    if (!container) return;
    container.innerHTML = '';
    
    currentDesktopItems.forEach(item => {
        const icon = document.createElement('div');
        icon.className = 'desktop-icon';
        icon.setAttribute('data-id', item.id);
        icon.setAttribute('draggable', 'true');
        
        if (item.x !== undefined && item.y !== undefined) {
            icon.style.position = 'absolute';
            icon.style.left = item.x + 'px';
            icon.style.top = item.y + 'px';
        }
        
        // Показываем оригинальное имя если есть
        const displayName = item.originalName || item.name;
        const titleAttr = item.originalName ? `title="${item.originalName}"` : '';
        
        icon.innerHTML = `
            <div class="icon-img">${item.type === 'folder' ? '<i class="fas fa-folder"></i>' : (item.url ? '<i class="fas fa-image"></i>' : '<i class="fas fa-file"></i>')}</div>
            <div class="icon-label">${item.name}</div>
        `;
        icon.setAttribute('title', displayName);
        
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
};

console.log('✅ Загрузчик изображений активирован!');
console.log('✅ K-OS обновлён с новыми функциями!');
console.log('✨ K-OS загружена!');

<!-- Design System -->
<!DOCTYPE html>

<html class="dark" lang="es"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>CRM Marketing Uphone - Panel de Asesor</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&amp;family=Inter:wght@400;500;600&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "secondary-fixed-dim": "#9ad4a5",
              "primary-fixed": "#6bfe9c",
              "primary": "#54e98a",
              "on-error-container": "#ffdad6",
              "outline-variant": "#3d4a3e",
              "primary-container": "#2ecc71",
              "surface-container": "#201f1f",
              "surface-container-lowest": "#0e0e0e",
              "on-secondary-fixed-variant": "#19512d",
              "on-secondary-fixed": "#00210c",
              "on-primary-fixed-variant": "#005228",
              "outline": "#869486",
              "on-secondary-container": "#89c294",
              "surface-bright": "#393939",
              "inverse-primary": "#006d37",
              "on-tertiary-fixed": "#390c00",
              "surface-container-high": "#2a2a2a",
              "on-primary": "#003919",
              "primary-fixed-dim": "#4ae183",
              "surface-container-low": "#1c1b1b",
              "secondary-fixed": "#b5f1c0",
              "surface-variant": "#353534",
              "on-surface": "#e5e2e1",
              "on-background": "#e5e2e1",
              "secondary": "#9ad4a5",
              "inverse-surface": "#e5e2e1",
              "surface-tint": "#4ae183",
              "surface": "#131313",
              "on-error": "#690005",
              "surface-dim": "#131313",
              "error-container": "#93000a",
              "tertiary-container": "#ff9875",
              "on-tertiary-container": "#772e14",
              "error": "#ffb4ab",
              "on-tertiary": "#5b1a02",
              "on-primary-fixed": "#00210c",
              "on-tertiary-fixed-variant": "#793015",
              "on-surface-variant": "#bbcbbb",
              "background": "#131313",
              "tertiary-fixed-dim": "#ffb59d",
              "on-secondary": "#003919",
              "on-primary-container": "#005027",
              "surface-container-highest": "#353534",
              "secondary-container": "#19512d",
              "inverse-on-surface": "#313030",
              "tertiary-fixed": "#ffdbd0",
              "tertiary": "#ffc0ac"
            },
            fontFamily: {
              "headline": ["Manrope"],
              "body": ["Inter"],
              "label": ["Inter"]
            },
            borderRadius: {"DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem"},
          },
        },
      }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        .pulse-glow {
            box-shadow: 0 0 0 0 rgba(84, 233, 138, 0.4);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(84, 233, 138, 0.4); }
            70% { box-shadow: 0 0 0 10px rgba(84, 233, 138, 0); }
            100% { box-shadow: 0 0 0 0 rgba(84, 233, 138, 0); }
        }
        .audio-wave {
            display: flex;
            align-items: flex-end;
            gap: 2px;
            height: 16px;
        }
        .bar {
            width: 3px;
            background: #54e98a;
            border-radius: 1px;
            animation: wave 1s ease-in-out infinite;
        }
        @keyframes wave {
            0%, 100% { height: 4px; }
            50% { height: 16px; }
        }
        .bar:nth-child(2) { animation-delay: 0.1s; }
        .bar:nth-child(3) { animation-delay: 0.2s; }
        .bar:nth-child(4) { animation-delay: 0.3s; }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
</head>
<body class="bg-background text-on-surface font-body selection:bg-primary selection:text-on-primary">
<!-- Sidebar Navigation (NavigationDrawer) -->
<aside class="fixed left-0 top-0 h-full z-40 flex flex-col py-6 bg-[#1c1b1b] dark:bg-[#1c1b1b] shadow-2xl shadow-black/50 rounded-r-none w-72">
<div class="px-8 mb-10">
<h2 class="font-['Manrope'] font-bold text-[#54e98a] tracking-tight uppercase">Terminal Role</h2>
</div>
<nav class="flex-1 flex flex-col gap-1">
<a class="text-gray-400 hover:text-white px-4 py-3 mx-2 transition-all duration-300 ease-in-out hover:bg-[#2a2a2a] flex items-center gap-3" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
<span class="font-['Inter'] font-medium text-sm">Panel de Control</span>
</a>
<a class="bg-gradient-to-br from-[#54e98a] to-[#2ecc71] text-[#131313] font-bold rounded-lg mx-2 px-4 py-3 transition-all duration-300 ease-in-out flex items-center gap-3" href="#">
<span class="material-symbols-outlined" data-icon="operator_licence">license</span>
<span class="font-['Inter'] font-medium text-sm">Consola de Asesor</span>
</a>
</nav>
<div class="px-6 py-4 mt-auto">
<div class="bg-surface-container-high rounded-xl p-4 border border-outline-variant/15">
<div class="flex items-center gap-3 mb-2">
<span class="material-symbols-outlined text-primary" data-icon="smartphone">smartphone</span>
<span class="text-xs font-bold tracking-widest uppercase opacity-60">Nodo del Sistema</span>
</div>
<p class="text-[10px] leading-tight text-on-surface-variant">Infinix Smart Series Detectado<br/>Protocolo: ADB-Secure</p>
</div>
</div>
</aside>
<!-- Main Content Area -->
<main class="ml-72 min-h-screen flex flex-col">
<!-- Header (TopAppBar) -->
<header class="flex justify-between items-center px-8 h-20 w-full bg-[#1c1b1b] flat no shadows docked full-width top-0 sticky z-30 border-b border-outline-variant/10">
<div class="flex items-center gap-4">
<span class="material-symbols-outlined text-[#54e98a] text-2xl" data-icon="terminal">terminal</span>
<h1 class="font-['Manrope'] font-black tracking-tighter text-[#54e98a] uppercase text-2xl flex-1 text-center px-4">TERMINAL DE COBRANZA UPHONE TEC SAS</h1>
</div>
<div class="flex items-center gap-6">
<!-- Status Indicator -->
<div class="flex items-center gap-3 bg-surface-container px-4 py-2 rounded-full border border-outline-variant/10">
<div class="w-2 h-2 rounded-full bg-primary pulse-glow"></div>
<span class="text-xs font-bold tracking-widest text-primary uppercase">Conectado</span>
</div>
<div class="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center overflow-hidden border-2 border-primary">
<img alt="Perfil de Asesor" class="w-full h-full object-cover" data-alt="Asesor profile avatar placeholder" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAmSjY0l9ifg9pJJPDD7yc7ernhA9LTC91lPruHWeVs8mUW_dEqtrDyLNYi5oa8q3Oxg6DuoffufKxwtdkticFgCmzqkY10iMGYy-tah_Us5sXcqFLfU3qg4XkDhsaaM9GCvGyF1u84g0K4WJNMzcaeqs2qwhHXZRysJMTUKCp-Gld8bRbnA06okJqcY4moDf17H5F2WFmSB3fv6housJVK-jonGGlzTO8nC8oe_OR9Aojt4vJZ8m4T9RP7zEQBnmTgwARsIR0XPUM"/>
</div>
</div>
</header>
<!-- Content Body -->
<div class="p-10 flex-1 bg-surface">
<div class="grid grid-cols-12 gap-8 max-w-7xl mx-auto">
<!-- Hero Section: Connection Actions -->
<section class="col-span-12 md:col-span-8 flex flex-col gap-8">
<div class="bg-surface-container-low rounded-xl p-8 flex flex-col md:flex-row items-center justify-between gap-6 border border-outline-variant/5">
<div class="flex-1">
<h2 class="font-headline text-3xl font-extrabold tracking-tight mb-2">Protocolo de Terminal</h2>
<p class="text-on-surface-variant text-sm">Seleccione una interfaz de alta velocidad para iniciar el puente de cobranza.</p>
</div>
<div class="flex gap-4 w-full md:w-auto">
<button class="flex-1 md:flex-none group relative bg-gradient-to-br from-[#54e98a] to-[#2ecc71] hover:brightness-110 active:scale-95 transition-all text-[#131313] font-bold py-4 px-8 rounded-xl flex items-center justify-center gap-3 shadow-lg shadow-primary/20">
<span class="material-symbols-outlined" data-icon="usb">usb</span>
<span>Conectar USB</span>
</button>
<button class="flex-1 md:flex-none group bg-surface-container-high hover:bg-surface-variant border border-primary/20 active:scale-95 transition-all text-primary font-bold py-4 px-8 rounded-xl flex items-center justify-center gap-3">
<span class="material-symbols-outlined" data-icon="wifi">wifi</span>
<span>Sincronizar WIFI</span>
</button>
</div>
</div>
<!-- Bento Grid for Stats & Management -->
<div class="grid grid-cols-1 md:grid-cols-2 gap-8">
<!-- Call Stream Status -->
<div class="bg-surface-container-high rounded-xl p-6 border border-outline-variant/10">
<div class="flex justify-between items-start mb-6">
<div>
<p class="text-[10px] font-bold tracking-[0.2em] text-primary uppercase mb-1">Transmisión de Audio en Vivo</p>
<h3 class="font-headline text-xl font-bold">Puente de Llamada Activo</h3>
</div>
<div class="audio-wave">
<div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="bar"></div>
</div>
</div>
<div class="bg-surface-container-lowest rounded-lg p-4 flex items-center justify-between">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded-full bg-surface-container-highest flex items-center justify-center">
<span class="material-symbols-outlined text-sm" data-icon="call">call</span>
</div>
<div>
<p class="text-xs font-medium text-on-surface">Cola: COB-MX-09</p>
<p class="text-[10px] text-on-surface-variant">Duración: 04:22</p>
</div>
</div>
<button class="text-error text-xs font-bold hover:underline">TERMINAR</button>
</div>
</div>
<!-- System Integrity -->
<div class="bg-surface-container-high rounded-xl p-6 border border-outline-variant/10 relative overflow-hidden">
<div class="absolute -right-4 -bottom-4 opacity-5">
<span class="material-symbols-outlined text-8xl" data-icon="memory">memory</span>
</div>
<p class="text-[10px] font-bold tracking-[0.2em] text-tertiary uppercase mb-1">Infraestructura</p>
<h3 class="font-headline text-xl font-bold mb-4">Salud del Dispositivo</h3>
<div class="space-y-3">
<div class="flex justify-between items-center text-xs">
<span class="text-on-surface-variant">Estado del Puente Infinix</span>
<span class="text-primary font-mono">ESTABLE</span>
</div>
<div class="w-full h-1 bg-surface-container-lowest rounded-full overflow-hidden">
<div class="w-[85%] h-full bg-primary"></div>
</div>
<div class="flex justify-between items-center text-xs">
<span class="text-on-surface-variant">Latencia de Señal</span>
<span class="text-on-surface font-mono">14ms</span>
</div>
</div>
</div>
</div>
</section>
<!-- Sidebar Content: Advisor Status -->
<section class="col-span-12 md:col-span-4 flex flex-col gap-8">
<div class="bg-surface-container-low rounded-xl p-6 border border-outline-variant/5">
<h3 class="font-headline text-lg font-bold mb-6 flex items-center gap-2"><span class="material-symbols-outlined text-primary" data-icon="person_pin_circle">person_pin_circle</span> Estado Asesor</h3>
<div class="flex flex-col gap-3">
<!-- Status Selector Buttons -->
<button class="w-full px-5 py-4 rounded-xl flex items-center justify-between bg-primary/10 border border-primary/30 text-primary font-bold transition-all hover:bg-primary/20">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined" data-icon="headset_mic">headset_mic</span>
<span class="text-sm">En gestión</span>
</div>
<span class="material-symbols-outlined text-sm" data-icon="check_circle" style="font-variation-settings: 'FILL' 1;">check_circle</span>
</button>
<button class="w-full px-5 py-4 rounded-xl flex items-center justify-between bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all hover:bg-surface-variant border border-transparent">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined" data-icon="wc">wc</span>
<span class="text-sm">Baño</span>
</div>
</button>
<button class="w-full px-5 py-4 rounded-xl flex items-center justify-between bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all hover:bg-surface-variant border border-transparent">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined" data-icon="keyboard">keyboard</span>
<span class="text-sm">Ingreso datos</span>
</div>
</button>
<button class="w-full px-5 py-4 rounded-xl flex items-center justify-between bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all hover:bg-surface-variant border border-transparent">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined" data-icon="coffee">coffee</span>
<span class="text-sm">Descanso</span>
</div>
</button>
<button class="w-full px-5 py-4 rounded-xl flex items-center justify-between bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-all hover:bg-surface-variant border border-transparent">
<div class="flex items-center gap-3">
<span class="material-symbols-outlined" data-icon="school">school</span>
<span class="text-sm">Capacitación</span>
</div>
</button>
</div>
<div class="mt-8 pt-6 border-t border-outline-variant/10">
<div class="flex items-center justify-between text-[10px] font-bold tracking-widest text-on-surface-variant uppercase mb-4">
<span>Métricas Diarias</span>
<span class="text-primary">82% Eficiencia</span>
</div>
<div class="grid grid-cols-1 gap-4">
<div class="bg-surface-container-lowest p-3 rounded-lg flex justify-between items-center">
<p class="text-xs text-on-surface-variant">Llamadas realizadas</p>
<p class="font-headline font-bold">48</p>
</div>
<div class="bg-surface-container-lowest p-3 rounded-lg flex justify-between items-center">
<p class="text-xs text-on-surface-variant">Tiempo de habla</p>
<p class="font-headline font-bold">3.2h</p>
</div>
<div class="bg-surface-container-lowest p-3 rounded-lg flex justify-between items-center">
<p class="text-xs text-on-surface-variant">Tiempo improductivo</p>
<p class="font-headline font-bold text-tertiary">0.8h</p>
</div>
</div>
</div>
</div>
<!-- Notification / Log -->
<div class="bg-[#2a2a2a] rounded-xl p-4 border-l-4 border-tertiary">
<div class="flex gap-3">
<span class="material-symbols-outlined text-tertiary text-xl" data-icon="priority_high">priority_high</span>
<div>
<h4 class="text-xs font-bold text-on-surface">Advertencia de Cumplimiento</h4>
<p class="text-[10px] text-on-surface-variant leading-relaxed mt-1">Tiempo máximo de 'Ingreso datos' alcanzado para este bloque. Cambie a 'En gestión'.</p>
</div>
</div>
</div>
</section>
</div>
</div>
<!-- System Footer (BottomNavBar) -->
<footer class="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center pb-safe bg-[#131313]/80 backdrop-blur-xl h-16 border-t border-white/5 shadow-[0_-4px_20px_rgba(0,0,0,0.5)] md:hidden">
<button class="flex flex-col items-center justify-center text-[#54e98a] drop-shadow-[0_0_8px_rgba(84,233,138,0.5)] active:scale-90 transition-transform">
<span class="material-symbols-outlined" data-icon="usb">usb</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest mt-1">Conectar USB</span>
</button>
<button class="flex flex-col items-center justify-center text-gray-600 hover:text-[#54e98a]/80 active:scale-90 transition-transform">
<span class="material-symbols-outlined" data-icon="wifi">wifi</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest mt-1">Sincro WIFI</span>
</button>
<button class="flex flex-col items-center justify-center text-gray-600 hover:text-[#54e98a]/80 active:scale-90 transition-transform">
<span class="material-symbols-outlined" data-icon="sensors">sensors</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest mt-1">Estado</span>
</button>
</footer>
</main>
</body></html>

<!-- Panel Asesor: Dashboard Actualizado -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Precision Terminal - Advisor Monitoring</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&amp;family=Inter:wght@400;500;600&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "secondary-fixed-dim": "#9ad4a5",
                        "primary-fixed": "#6bfe9c",
                        "primary": "#54e98a",
                        "on-error-container": "#ffdad6",
                        "outline-variant": "#3d4a3e",
                        "primary-container": "#2ecc71",
                        "surface-container": "#201f1f",
                        "surface-container-lowest": "#0e0e0e",
                        "on-secondary-fixed-variant": "#19512d",
                        "on-secondary-fixed": "#00210c",
                        "on-primary-fixed-variant": "#005228",
                        "outline": "#869486",
                        "on-secondary-container": "#89c294",
                        "surface-bright": "#393939",
                        "inverse-primary": "#006d37",
                        "on-tertiary-fixed": "#390c00",
                        "surface-container-high": "#2a2a2a",
                        "on-primary": "#003919",
                        "primary-fixed-dim": "#4ae183",
                        "surface-container-low": "#1c1b1b",
                        "secondary-fixed": "#b5f1c0",
                        "surface-variant": "#353534",
                        "on-surface": "#e5e2e1",
                        "on-background": "#e5e2e1",
                        "secondary": "#9ad4a5",
                        "inverse-surface": "#e5e2e1",
                        "surface-tint": "#4ae183",
                        "surface": "#131313",
                        "on-error": "#690005",
                        "surface-dim": "#131313",
                        "error-container": "#93000a",
                        "tertiary-container": "#ff9875",
                        "on-tertiary-container": "#772e14",
                        "error": "#ffb4ab",
                        "on-tertiary": "#5b1a02",
                        "on-primary-fixed": "#00210c",
                        "on-tertiary-fixed-variant": "#793015",
                        "on-surface-variant": "#bbcbbb",
                        "background": "#131313",
                        "tertiary-fixed-dim": "#ffb59d",
                        "on-secondary": "#003919",
                        "on-primary-container": "#005027",
                        "surface-container-highest": "#353534",
                        "secondary-container": "#19512d",
                        "inverse-on-surface": "#313030",
                        "tertiary-fixed": "#ffdbd0",
                        "tertiary": "#ffc0ac"
                    },
                    fontFamily: {
                        "headline": ["Manrope"],
                        "body": ["Inter"],
                        "label": ["Inter"]
                    },
                    borderRadius: { "DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem" },
                },
            },
        }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        body {
            background-color: #131313;
            color: #e5e2e1;
            font-family: 'Inter', sans-serif;
        }
        .pulse-active {
            box-shadow: 0 0 0 0 rgba(84, 233, 138, 0.4);
            animation: pulse 2s infinite;
        }
        @keyframes pulse {
            0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(84, 233, 138, 0.7); }
            70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(84, 233, 138, 0); }
            100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(84, 233, 138, 0); }
        }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
</head>
<body class="flex overflow-hidden h-screen bg-background">
<!-- NavigationDrawer -->
<aside class="fixed left-0 top-0 h-full z-40 flex flex-col py-6 bg-[#1c1b1b] dark:bg-[#1c1b1b] rounded-r-none w-72 shadow-2xl shadow-black/50 transition-all duration-300 ease-in-out">
<div class="px-8 mb-10">
<span class="font-['Manrope'] font-bold text-[#54e98a] tracking-tight text-xs uppercase opacity-60">ROL DE TERMINAL</span>
<h2 class="font-['Manrope'] font-black tracking-tighter text-[#54e98a] text-xl mt-1 uppercase">SUPERVISOR</h2>
</div>
<nav class="flex-1 space-y-1">
<a class="text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-4 transition-all duration-300 ease-in-out hover:bg-[#2a2a2a] group" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
<span class="font-['Inter'] font-medium text-sm">Panel de Control</span>
</a>
<a class="bg-gradient-to-br from-[#54e98a] to-[#2ecc71] text-[#131313] font-bold rounded-lg mx-2 px-4 py-3 flex items-center gap-4 transition-all duration-300 ease-in-out" href="#">
<span class="material-symbols-outlined" data-icon="operator_licence" style="font-variation-settings: 'FILL' 1;">license</span>
<span class="font-['Inter'] font-medium text-sm">Consola de Asesor</span>
</a>
<a class="text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-4 transition-all duration-300 ease-in-out hover:bg-[#2a2a2a] group" href="#">
<span class="material-symbols-outlined" data-icon="analytics">analytics</span>
<span class="font-['Inter'] font-medium text-sm">Registros de Supervisor</span>
</a>
<a class="text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-4 transition-all duration-300 ease-in-out hover:bg-[#2a2a2a] group" href="#">
<span class="material-symbols-outlined" data-icon="settings_input_component">settings_input_component</span>
<span class="font-['Inter'] font-medium text-sm">Configuración del Sistema</span>
</a>
</nav>
<div class="px-6 mt-auto">
<div class="bg-surface-container-high p-4 rounded-xl flex items-center gap-3">
<div class="w-10 h-10 rounded-full bg-primary-container/20 flex items-center justify-center text-primary">
<span class="material-symbols-outlined" data-icon="person">person</span>
</div>
<div>
<p class="text-xs font-bold text-on-surface">Admin_01</p>
<p class="text-[10px] text-primary uppercase tracking-widest">Online</p>
</div>
</div>
</div>
</aside>
<!-- Main Content Area -->
<main class="flex-1 ml-72 flex flex-col h-full bg-surface">
<!-- TopAppBar -->
<header class="flex justify-between items-center px-8 h-20 w-full bg-[#131313] dark:bg-[#131313] no-line tonal shift bg-[#1c1b1b] flat no shadows">
<div class="flex items-center gap-4">
<span class="material-symbols-outlined text-[#54e98a] text-3xl" data-icon="terminal">terminal</span>
<h1 class="font-['Manrope'] font-black tracking-tighter text-[#54e98a] uppercase text-2xl">PRECISION TERMINAL</h1>
</div>
<div class="flex items-center gap-8">
<div class="hidden md:flex items-center gap-6">
<a class="text-[#54e98a] border-b-2 border-[#54e98a] py-1 font-['Inter'] text-sm font-bold tracking-tight" href="#">Monitoreo</a>
<a class="text-gray-500 hover:text-[#54e98a] transition-colors py-1 font-['Inter'] text-sm" href="#">Historial</a>
<a class="text-gray-500 hover:text-[#54e98a] transition-colors py-1 font-['Inter'] text-sm" href="#">Reportes</a>
</div>
<div class="flex items-center gap-4">
<button class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[#2a2a2a] transition-colors text-on-surface-variant">
<span class="material-symbols-outlined" data-icon="notifications">notifications</span>
</button>
<img alt="Supervisor Profile" class="w-10 h-10 rounded-full border-2 border-[#54e98a] object-cover" data-alt="Supervisor profile headshot in circular avatar" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCfpz90N-zhOedsz6ZMlxcQ1vOm9NF9lJz4z8nmfC-0wlU7ZdY--6D7xfmuOUK0V4vk6x6x2G8P0GKxu7_nw0avXvqdXuZYMZPjdZk8qop89SL9L84fn5djkqilmrYDJeKdC3gnscQIE_drOKWCCXhXjrBcd7XVqPLxOyWfMf7qsJUU2Tjuck8JEe5wdpRAr7R-76MzBalL__msrMPGjuEfg4RDxWZ8sxXY9mIEzti_HXG85XUeSoTq7RZMdjDdcnkrAKGFlBfFxxM"/>
</div>
</div>
</header>
<!-- Monitoring Interface -->
<div class="flex-1 overflow-y-auto p-10 space-y-10">
<!-- Filters & Stats Bento -->
<section class="grid grid-cols-12 gap-6">
<!-- Live Search Bar -->
<div class="col-span-12 lg:col-span-8 bg-surface-container-low p-6 rounded-xl flex items-center gap-4">
<span class="material-symbols-outlined text-primary" data-icon="search">search</span>
<input class="bg-transparent border-none focus:ring-0 text-on-surface w-full placeholder:text-outline font-['Inter'] text-lg" placeholder="Buscar asesor por nombre, estado o ID..." type="text"/>
<div class="flex gap-2">
<button class="px-4 py-2 bg-surface-container-high hover:bg-surface-variant rounded-lg text-xs font-bold text-on-surface-variant uppercase tracking-widest transition-colors flex items-center gap-2"><span class="material-symbols-outlined text-sm" data-icon="filter_list">filter_list</span> Filtros</button>
</div>
</div>
<!-- Quick Metrics Chip -->
<div class="col-span-12 lg:col-span-4 bg-surface-container-low p-6 rounded-xl flex justify-between items-center">
<div>
<p class="text-[10px] uppercase tracking-[0.2em] text-outline font-bold">Operadores Activos</p>
<p class="text-3xl font-black font-headline text-primary mt-1">12<span class="text-lg opacity-40 font-normal ml-2">/ 15</span></p>
</div>
<div class="flex gap-2">
<div class="w-2 h-2 rounded-full bg-primary pulse-active"></div>
<div class="w-2 h-2 rounded-full bg-primary pulse-active" style="animation-delay: 0.5s"></div>
<div class="w-2 h-2 rounded-full bg-primary pulse-active" style="animation-delay: 1s"></div>
</div>
</div>
</section>
<!-- Advisor List -->
<section class="space-y-4">
<div class="flex justify-between items-end mb-6 px-4">
<h3 class="font-headline font-bold text-xl tracking-tight">Cola de Asesoría Activa</h3>
<p class="text-xs text-outline font-['Inter']">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
</div>
<!-- Advisor Rows -->
<div class="bg-surface-container-lowest rounded-xl overflow-hidden">
<!-- Row 1: Active -->
<div class="group flex items-center justify-between p-6 hover:bg-surface-container-low transition-colors duration-300">
<div class="flex items-center gap-6 w-1/4">
<div class="relative">
<img alt="Juan Perez" class="w-12 h-12 rounded-lg object-cover grayscale group-hover:grayscale-0 transition-all" data-alt="Portrait of Juan Perez for advisor list" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCX3eYov5h1epxo5skO1VHAZ7C57YYUyNt4jy4pFL4lH0d9Wq0d_tW3uxwNiKAxtkcD3g80p2CXi3haobaeGtlz6j8KAEbfhjeePTi0rlEM6q9-3QLjOxpro06xxceqf3gELVITfHCNB2TZZUAlb5ySAXYP-ArEaV5JL8i64La0tw_Hb_qQmmHX9vk0eXo7smAh7vu2eEapMnWlM6t6TUU9DWG3P74KXAC5SOtqb8lKINL22eiX0FyRAsv4wqFuSbGf6PpA1fa2K7k"/>
<div class="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full border-2 border-surface-container-lowest pulse-active"></div>
</div>
<div>
<h4 class="font-bold text-on-surface">Juan Perez</h4>
<p class="text-xs text-primary font-medium">En gestión</p>
</div>
</div>
<div class="flex-1 grid grid-cols-3 gap-8 px-10">
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">04:12 <span class="material-symbols-outlined text-[10px] align-middle ml-1 text-primary" data-icon="trending_up">trending_up</span></p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">28</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1 text-primary-fixed-dim">98%</p>
</div>
</div>
<div class="flex items-center gap-4">
<button class="bg-gradient-to-br from-[#54e98a] to-[#2ecc71] text-[#131313] px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-tight flex items-center gap-2 hover:shadow-[0_0_15px_rgba(84,233,138,0.3)] transition-all active:scale-95">
<span class="material-symbols-outlined text-sm" data-icon="headset_mic" style="font-variation-settings: 'FILL' 1;">headset_mic</span>
                                Escuchar Llamada
                            </button>
<button class="w-10 h-10 rounded-lg border border-outline-variant hover:bg-surface-container-high transition-colors text-outline">
<span class="material-symbols-outlined text-sm" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
<!-- Row 2: Inactive/Wrap-up -->
<div class="group flex items-center justify-between p-6 hover:bg-surface-container-low transition-colors duration-300 border-t border-white/5">
<div class="flex items-center gap-6 w-1/4">
<div class="relative">
<img alt="Maria Garcia" class="w-12 h-12 rounded-lg object-cover grayscale group-hover:grayscale-0 transition-all" data-alt="Portrait of Maria Garcia for advisor list" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDND5qprSchReA1YcZsldEcX571ISQl2-CBobISxAXfecbmwZu2N5vJRaFH1GDdGrs2eJPWAq5js6FpJRv4ziTHn1l1rl0WNIBsMY4ML3CSskcjv9PibuB38jZYZjeXcjbrwkpdaRmQfbB3iInz_WGTcyQ53jd-uLiuDmxcFJgocVF28y3W5PuPNmMAb1xGEEYVJUgXUGqVUynuxeMNB8axFvoxz3x3WVhDpKJEzV3EPS388c2SS_Vp3W4FsdubqAiF8ojjGdiLs8c"/>
<div class="absolute -bottom-1 -right-1 w-4 h-4 bg-tertiary-container rounded-full border-2 border-surface-container-lowest"></div>
</div>
<div>
<h4 class="font-bold text-on-surface">Maria Garcia</h4>
<p class="text-xs text-tertiary font-medium">Post-llamada</p>
</div>
</div>
<div class="flex-1 grid grid-cols-3 gap-8 px-10">
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">12:45</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">42</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1 text-primary-fixed-dim">94%</p>
</div>
</div>
<div class="flex items-center gap-4">
<button class="bg-surface-container-high text-outline px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-tight flex items-center gap-2 opacity-50 cursor-not-allowed" disabled="">
<span class="material-symbols-outlined text-sm" data-icon="headset_mic">headset_mic</span>
                                Escuchar Llamada
                            </button>
<button class="w-10 h-10 rounded-lg border border-outline-variant hover:bg-surface-container-high transition-colors text-outline">
<span class="material-symbols-outlined text-sm" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
<!-- Row 3: Active -->
<div class="group flex items-center justify-between p-6 hover:bg-surface-container-low transition-colors duration-300 border-t border-white/5">
<div class="flex items-center gap-6 w-1/4">
<div class="relative">
<img alt="Carlos Ruiz" class="w-12 h-12 rounded-lg object-cover grayscale group-hover:grayscale-0 transition-all" data-alt="Portrait of Carlos Ruiz for advisor list" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAPAuaKjcHhLmVpfrHQh1zSoiOA0UDWF7NCGknnsBHmzK6EMe22w80e2kuQWPhr3kfF0pYLlulbRa1AOA5zKJPQ2u7T1Q10GhfkWQSr35hlB2Am2MgWBOA3pQnpvOwGFfDue0erxkpJjAKBNJ7jXFSCIjv6rPXIH8ZGkSPc3DXgnuY3mAfqVZrTzulNDsUi4HhAex9PURDZMg0Mk52E3u1ZBo8xy6V_i2L19c2freFSJYkFiRGhWKDPoD85rUaG_AdFZ1eXnXle-Tg"/>
<div class="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full border-2 border-surface-container-lowest pulse-active"></div>
</div>
<div>
<h4 class="font-bold text-on-surface">Carlos Ruiz</h4>
<p class="text-xs text-primary font-medium">En gestión</p>
</div>
</div>
<div class="flex-1 grid grid-cols-3 gap-8 px-10">
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">01:30</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">15</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1 text-primary-fixed-dim">89%</p>
</div>
</div>
<div class="flex items-center gap-4">
<button class="bg-gradient-to-br from-[#54e98a] to-[#2ecc71] text-[#131313] px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-tight flex items-center gap-2 hover:shadow-[0_0_15px_rgba(84,233,138,0.3)] transition-all active:scale-95">
<span class="material-symbols-outlined text-sm" data-icon="headset_mic" style="font-variation-settings: 'FILL' 1;">headset_mic</span>
                                Escuchar Llamada
                            </button>
<button class="w-10 h-10 rounded-lg border border-outline-variant hover:bg-surface-container-high transition-colors text-outline">
<span class="material-symbols-outlined text-sm" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
<!-- Row 4: Active -->
<div class="group flex items-center justify-between p-6 hover:bg-surface-container-low transition-colors duration-300 border-t border-white/5">
<div class="flex items-center gap-6 w-1/4">
<div class="relative">
<img alt="Elena Silva" class="w-12 h-12 rounded-lg object-cover grayscale group-hover:grayscale-0 transition-all" data-alt="Portrait of Elena Silva for advisor list" src="https://lh3.googleusercontent.com/aida-public/AB6AXuAwgckVWH7Qn6r-ww0vEhxposGWhrYH3XD7pxRmpAiKeOL1U1GovffZanCO1Tia2QcUM6Bnn7SBQ7hP_nVr_SwDmJ8hsh6tBI_cx70aJd96AqdmSRyReN7VvtuHCUZjHhiDM99lYAoY2nGVynJebp_2DS7REyEl0DritKGTbE9xAuAndL-73vv8GuKRgLFxgok-M9CaOQPJdA5fyA8Ge6WQsMpjYoXZugwVFvY9dbp-IfHhotieDlJw2bwDAstRccktmqLGQveUzgQ"/>
<div class="absolute -bottom-1 -right-1 w-4 h-4 bg-primary rounded-full border-2 border-surface-container-lowest pulse-active"></div>
</div>
<div>
<h4 class="font-bold text-on-surface">Elena Silva</h4>
<p class="text-xs text-primary font-medium">En gestión</p>
</div>
</div>
<div class="flex-1 grid grid-cols-3 gap-8 px-10">
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">18:22 <span class="material-symbols-outlined text-[10px] align-middle ml-1 text-error" data-icon="warning">warning</span></p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1">31</p>
</div>
<div>
<p class="text-[10px] uppercase tracking-widest text-outline">Última actualización: <span class="text-primary-fixed-dim">Justo ahora</span></p>
<p class="text-sm font-bold font-headline mt-1 text-primary-fixed-dim">99%</p>
</div>
</div>
<div class="flex items-center gap-4">
<button class="bg-gradient-to-br from-[#54e98a] to-[#2ecc71] text-[#131313] px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-tight flex items-center gap-2 hover:shadow-[0_0_15px_rgba(84,233,138,0.3)] transition-all active:scale-95">
<span class="material-symbols-outlined text-sm" data-icon="headset_mic" style="font-variation-settings: 'FILL' 1;">headset_mic</span>
                                Escuchar Llamada
                            </button>
<button class="w-10 h-10 rounded-lg border border-outline-variant hover:bg-surface-container-high transition-colors text-outline">
<span class="material-symbols-outlined text-sm" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
</div>
</section>
</div>
<!-- BottomNavBar (Mobile Only) -->
<nav class="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center pb-safe bg-[#131313]/80 backdrop-blur-xl h-16 border-t border-white/5 glassmorphic shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
<button class="flex flex-col items-center justify-center text-gray-600 hover:text-[#54e98a]/80 transition-transform active:scale-90">
<span class="material-symbols-outlined" data-icon="usb">usb</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest">CONEXIÓN USB</span>
</button>
<button class="flex flex-col items-center justify-center text-gray-600 hover:text-[#54e98a]/80 transition-transform active:scale-90">
<span class="material-symbols-outlined" data-icon="wifi">wifi</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest">SINCRONIZACIÓN WIFI</span>
</button>
<button class="flex flex-col items-center justify-center text-[#54e98a] drop-shadow-[0_0_8px_rgba(84,233,138,0.5)] transition-transform active:scale-90">
<span class="material-symbols-outlined" data-icon="sensors" style="font-variation-settings: 'FILL' 1;">sensors</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest">ESTADO</span>
</button>
</nav>
</main>
<!-- Contextual FAB (Only on Dashboard/Home Monitoring) -->
<button class="fixed right-8 bottom-8 w-14 h-14 rounded-full bg-primary text-on-primary shadow-2xl shadow-primary/20 flex items-center justify-center hover:scale-110 active:scale-90 transition-transform z-50">
<span class="material-symbols-outlined" data-icon="add">add</span>
</button>
</body></html>

<!-- Panel Supervisor: Monitoreo -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Precision Terminal - Secure Login</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@200;400;600;800&amp;family=Inter:wght@300;400;500;600&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
      tailwind.config = {
        darkMode: "class",
        theme: {
          extend: {
            colors: {
              "primary": "#54e98a",
              "on-secondary-fixed": "#00210c",
              "error": "#ffb4ab",
              "surface": "#131313",
              "on-surface": "#e5e2e1",
              "on-primary-container": "#005027",
              "primary-container": "#2ecc71",
              "inverse-primary": "#006d37",
              "surface-container-high": "#2a2a2a",
              "inverse-surface": "#e5e2e1",
              "tertiary": "#ffc0ac",
              "on-primary-fixed": "#00210c",
              "on-secondary": "#003919",
              "secondary-fixed": "#b5f1c0",
              "on-error": "#690005",
              "secondary-fixed-dim": "#9ad4a5",
              "surface-container-low": "#1c1b1b",
              "surface-bright": "#393939",
              "primary-fixed-dim": "#4ae183",
              "on-primary": "#003919",
              "primary-fixed": "#6bfe9c",
              "on-secondary-container": "#89c294",
              "error-container": "#93000a",
              "on-tertiary-container": "#772e14",
              "secondary": "#9ad4a5",
              "on-surface-variant": "#bbcbbb",
              "tertiary-fixed-dim": "#ffb59d",
              "surface-variant": "#353534",
              "surface-dim": "#131313",
              "surface-container": "#201f1f",
              "outline-variant": "#3d4a3e",
              "surface-container-lowest": "#0e0e0e",
              "tertiary-fixed": "#ffdbd0",
              "on-tertiary": "#5b1a02",
              "on-background": "#e5e2e1",
              "surface-tint": "#4ae183",
              "background": "#131313",
              "surface-container-highest": "#353534",
              "tertiary-container": "#ff9875",
              "outline": "#869486",
              "secondary-container": "#19512d",
              "inverse-on-surface": "#313030",
              "on-error-container": "#ffdad6",
              "on-secondary-fixed-variant": "#19512d",
              "on-tertiary-fixed": "#390c00",
              "on-tertiary-fixed-variant": "#793015",
              "on-primary-fixed-variant": "#005228"
            },
            fontFamily: {
              "headline": ["Manrope"],
              "body": ["Inter"],
              "label": ["Inter"]
            },
            borderRadius: {"DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem"},
          },
        },
      }
    </script>
<style>
      .material-symbols-outlined {
        font-variation-settings: 'FILL' 0, 'wght' 300, 'GRAD' 0, 'opsz' 24;
      }
      .glass-bg {
        backdrop-filter: blur(12px);
        background: rgba(32, 31, 31, 0.6);
      }
      .text-glow {
        text-shadow: 0 0 10px rgba(84, 233, 138, 0.4);
      }
    </style>
</head>
<body class="bg-surface text-on-surface font-body selection:bg-primary/30 min-h-screen flex flex-col items-center justify-center overflow-hidden">
<!-- Top Status Bar (Minimal) -->
<header class="fixed top-0 left-0 w-full px-8 py-6 flex justify-between items-center pointer-events-none z-50">
<div class="flex items-center gap-3">
<span class="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
<span class="font-headline text-[0.65rem] uppercase tracking-[0.2em] text-primary/80">System Online</span>
</div>
<div class="flex items-center gap-6">
<div class="flex items-center gap-2 px-3 py-1 bg-surface-container-high rounded-full pointer-events-auto">
<span class="material-symbols-outlined text-[14px] text-primary">verified_user</span>
<span class="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">Secure Connection</span>
</div>
</div>
</header>
<!-- Background Decoration -->
<div class="absolute inset-0 -z-10 overflow-hidden">
<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-[radial-gradient(circle_at_center,rgba(84,233,138,0.03)_0%,transparent_70%)]"></div>
<div class="absolute inset-0 bg-[linear-gradient(to_right,#1c1b1b_1px,transparent_1px),linear-gradient(to_bottom,#1c1b1b_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20"></div>
</div>
<!-- Main Content Centered Container -->
<main class="relative z-10 w-full max-w-[500px] px-6 flex flex-col items-center">
<!-- Brand Identity -->
<div class="text-center mb-6">
<h1 class="font-headline font-extrabold text-4xl tracking-tighter text-primary uppercase text-glow mb-2">TERMINAL DE COBRANZA UPHONE TEC SAS</h1>
<p class="font-headline text-[0.7rem] uppercase tracking-[0.4em] text-on-surface-variant/60">Digital Watchmaker V.2.0.4</p>
</div>
<!-- Auth Card -->
<div class="w-full bg-surface-container-low p-10 rounded-xl shadow-2xl relative overflow-hidden group">
<!-- Subtle Accent Light -->
<div class="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary/40 to-transparent"></div>
<form class="space-y-8">
<!-- Role Selector -->
<div class="space-y-3">
<label class="font-headline text-[0.65rem] uppercase tracking-widest text-on-surface-variant ml-1">ESTADO ASESOR</label>
<div class="grid bg-surface-container-lowest p-1 rounded-lg grid-cols-2">
<button class="py-2 text-[0.7rem] font-headline font-bold uppercase tracking-widest bg-surface-container-high text-primary rounded shadow-sm transition-all duration-300" type="button">ASESOR</button>
<button class="py-2 text-[0.7rem] font-headline font-medium uppercase tracking-widest text-on-surface-variant/40 hover:text-on-surface transition-colors" type="button">SUPERVISOR</button>
</div>
</div>
<!-- Input Fields -->
<div class="space-y-5">
<!-- Username -->
<div class="group/input relative">
<label class="font-headline text-[0.65rem] uppercase tracking-widest text-on-surface-variant ml-1 block mb-2 transition-colors group-focus-within/input:text-primary">USUARIO</label>
<div class="relative">
<span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">terminal</span>
<input class="w-full bg-surface-container-lowest border-none focus:ring-1 focus:ring-primary/50 rounded-lg py-4 pl-12 pr-4 font-body text-sm tracking-wide text-on-surface placeholder:text-on-surface-variant/20 transition-all duration-300" placeholder="EMP-000-00" type="text"/>
</div>
</div>
<!-- Password -->
<div class="group/input relative">
<div class="flex justify-between items-end mb-2">
<label class="font-headline text-[0.65rem] uppercase tracking-widest text-on-surface-variant ml-1 transition-colors group-focus-within/input:text-primary">CONTRASEÑA</label>
<a class="font-label text-[0.6rem] uppercase tracking-widest text-on-surface-variant/40 hover:text-primary transition-colors" href="#">Recover</a>
</div>
<div class="relative">
<span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-on-surface-variant text-[18px]">lock</span>
<input class="w-full bg-surface-container-lowest border-none focus:ring-1 focus:ring-primary/50 rounded-lg py-4 pl-12 pr-12 font-body text-sm tracking-wide text-on-surface placeholder:text-on-surface-variant/20 transition-all duration-300" placeholder="••••••••" type="password"/>
<button class="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface-variant transition-colors" type="button">
<span class="material-symbols-outlined text-[18px]">visibility</span>
</button>
</div>
</div>
</div>
<!-- Action -->
<div class="pt-4">
<button class="w-full py-4 rounded-full bg-gradient-to-br from-primary to-primary-container text-on-primary-fixed font-headline font-extrabold text-sm uppercase tracking-[0.2em] shadow-[0_8px_24px_rgba(46,204,113,0.15)] hover:shadow-[0_12px_32px_rgba(46,204,113,0.25)] hover:scale-[1.01] active:scale-95 transition-all duration-300" type="submit">
                        Authenticate
                    </button>
</div>
</form>
</div>
<!-- Footer Info -->
<div class="w-full flex justify-between items-center px-4 mt-8">
<div class="flex items-center gap-4">
<div class="text-right">
<p class="font-label text-[0.6rem] text-on-surface-variant/30 uppercase tracking-widest">Region</p>
<p class="font-label text-[0.65rem] text-on-surface-variant/60 font-bold uppercase tracking-widest">Global Node A</p>
</div>
<div class="h-6 w-[1px] bg-outline-variant/20"></div>
<div>
<p class="font-label text-[0.6rem] text-on-surface-variant/30 uppercase tracking-widest">Latency</p>
<p class="font-label text-[0.65rem] text-primary font-bold uppercase tracking-widest">12ms</p>
</div>
</div>
<div class="text-right">
<span class="font-headline text-[0.6rem] font-medium text-on-surface-variant/40 uppercase tracking-[0.3em]">V.2.0.4 - Secure</span>
</div>
</div>
</main>
<!-- Asymmetric Graphic Elements -->
<div class="fixed bottom-0 left-0 p-12 opacity-20 hidden lg:block">
<div class="space-y-1">
<div class="h-[2px] w-32 bg-primary"></div>
<div class="h-[2px] w-24 bg-primary/40"></div>
<div class="h-[2px] w-48 bg-primary/10"></div>
</div>
<p class="mt-4 font-headline text-[10px] uppercase tracking-[0.5em] text-on-surface-variant">Precision Terminal Ecosystem</p>
</div>
<div class="fixed top-0 right-0 p-12 opacity-20 hidden lg:block text-right">
<p class="font-headline text-[8px] uppercase tracking-[0.8em] text-on-surface-variant leading-relaxed">
            Encrypted Interface<br/>
            Biometric Fallback Enabled<br/>
            Strict Supervisor Protocol
        </p>
</div>
</body></html>

<!-- Login Centrado y Corregido: UPHONE TEC SAS -->
<!DOCTYPE html>

<html class="dark" lang="en"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Precision Terminal - Supervisor Dashboard</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&amp;family=Inter:wght@400;500;600&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            "secondary-fixed-dim": "#9ad4a5",
            "primary-fixed": "#6bfe9c",
            "primary": "#54e98a",
            "on-error-container": "#ffdad6",
            "outline-variant": "#3d4a3e",
            "primary-container": "#2ecc71",
            "surface-container": "#201f1f",
            "surface-container-lowest": "#0e0e0e",
            "on-secondary-fixed-variant": "#19512d",
            "on-secondary-fixed": "#00210c",
            "on-primary-fixed-variant": "#005228",
            "outline": "#869486",
            "on-secondary-container": "#89c294",
            "surface-bright": "#393939",
            "inverse-primary": "#006d37",
            "on-tertiary-fixed": "#390c00",
            "surface-container-high": "#2a2a2a",
            "on-primary": "#003919",
            "primary-fixed-dim": "#4ae183",
            "surface-container-low": "#1c1b1b",
            "secondary-fixed": "#b5f1c0",
            "surface-variant": "#353534",
            "on-surface": "#e5e2e1",
            "on-background": "#e5e2e1",
            "secondary": "#9ad4a5",
            "inverse-surface": "#e5e2e1",
            "surface-tint": "#4ae183",
            "surface": "#131313",
            "on-error": "#690005",
            "surface-dim": "#131313",
            "error-container": "#93000a",
            "tertiary-container": "#ff9875",
            "on-tertiary-container": "#772e14",
            "error": "#ffb4ab",
            "on-tertiary": "#5b1a02",
            "on-primary-fixed": "#00210c",
            "on-tertiary-fixed-variant": "#793015",
            "on-surface-variant": "#bbcbbb",
            "background": "#131313",
            "tertiary-fixed-dim": "#ffb59d",
            "on-secondary": "#003919",
            "on-primary-container": "#005027",
            "surface-container-highest": "#353534",
            "secondary-container": "#19512d",
            "inverse-on-surface": "#313030",
            "tertiary-fixed": "#ffdbd0",
            "tertiary": "#ffc0ac"
          },
          fontFamily: {
            "headline": ["Manrope"],
            "body": ["Inter"],
            "label": ["Inter"]
          },
          borderRadius: {"DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem"},
        },
      },
    }
  </script>
<style>
    .material-symbols-outlined {
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
    }
    .glass-panel {
      background: rgba(28, 27, 27, 0.6);
      backdrop-filter: blur(12px);
    }
    .glow-primary {
      box-shadow: 0 0 20px rgba(84, 233, 138, 0.15);
    }
    body {
      background-color: #131313;
      color: #e5e2e1;
      font-family: 'Inter', sans-serif;
    }
    .custom-scrollbar::-webkit-scrollbar {
      width: 4px;
    }
    .custom-scrollbar::-webkit-scrollbar-track {
      background: #131313;
    }
    .custom-scrollbar::-webkit-scrollbar-thumb {
      background: #3d4a3e;
      border-radius: 10px;
    }
  </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
</head>
<body class="bg-background text-on-background selection:bg-primary selection:text-on-primary">
<!-- Side Navigation Drawer -->
<aside class="fixed left-0 top-0 h-full z-40 flex flex-col py-6 bg-[#1c1b1b] dark:bg-[#1c1b1b] h-full w-72 shadow-2xl shadow-black/50">
<div class="px-8 mb-12">
<h2 class="font-['Manrope'] font-bold text-[#54e98a] tracking-tight">TERMINAL ROLE</h2>
</div>
<nav class="flex-1 space-y-2">
<a class="transition-all duration-300 ease-in-out bg-gradient-to-br from-[#54e98a] to-[#2ecc71] text-[#131313] font-bold rounded-lg mx-2 px-4 py-3 flex items-center gap-3" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
<span class="font-['Inter'] font-medium text-sm">Dashboard</span>
</a>
<a class="transition-all duration-300 ease-in-out text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-3 hover:bg-[#2a2a2a]" href="#">
<span class="material-symbols-outlined" data-icon="operator_licence">license</span>
<span class="font-['Inter'] font-medium text-sm">Advisor Console</span>
</a>
<a class="transition-all duration-300 ease-in-out text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-3 hover:bg-[#2a2a2a]" href="#">
<span class="material-symbols-outlined" data-icon="analytics">analytics</span>
<span class="font-['Inter'] font-medium text-sm">Supervisor Logs</span>
</a>
<a class="transition-all duration-300 ease-in-out text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-3 hover:bg-[#2a2a2a]" href="#">
<span class="material-symbols-outlined" data-icon="settings_input_component">settings_input_component</span>
<span class="font-['Inter'] font-medium text-sm">System Config</span>
</a>
</nav>
<div class="px-6 mt-auto">
<div class="p-4 rounded-xl bg-surface-container-high/50 border border-white/5">
<div class="flex items-center gap-3">
<div class="w-2 h-2 rounded-full bg-primary animate-pulse"></div>
<span class="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold">Terminal Seguro</span>
</div>
</div>
</div>
</aside>
<!-- Main Content Area -->
<main class="ml-72 min-h-screen flex flex-col">
<!-- Top App Bar -->
<header class="flex justify-between items-center px-8 h-20 w-full bg-[#131313] dark:bg-[#131313] no-line tonal shift bg-[#1c1b1b] sticky top-0 z-30">
<div class="flex items-center gap-4">
<span class="material-symbols-outlined text-[#54e98a] text-2xl" data-icon="terminal">terminal</span>
<h1 class="font-['Manrope'] font-black tracking-tighter text-[#54e98a] uppercase text-2xl">PRECISION TERMINAL</h1>
</div>
<div class="flex items-center gap-6">
<button class="bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-6 py-2.5 rounded-xl text-sm transition-transform active:scale-95 flex items-center gap-2 shadow-lg shadow-primary/20">
<span class="material-symbols-outlined text-sm" data-icon="description">description</span>
          Emitir Reportes
        </button>
<div class="flex items-center gap-3 pl-6 border-l border-white/5">
<div class="text-right">
<p class="text-xs font-bold text-on-surface">Supervisor Administrador</p>
<p class="text-[10px] text-primary/70 uppercase tracking-tighter">Acceso Nivel 4</p>
</div>
<img alt="Supervisor Profile" class="w-10 h-10 rounded-full border-2 border-primary/20 p-0.5 bg-surface-container-high" data-alt="Close up of professional avatar illustration" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA-rHGM3wJFvWNvER_XB1RksKrwTOUzH7mPyFft1e7PaTCk0nOxykZceVMK2TyIRTppsy2AnujRjqSbe3kzZ3DWKGQ0LFK_IAUhRYvlq_vr6qRr1Ztse3ZADOtGy6NPY6gQ513qORGgPDCrsRUfg7CRT_mBHITHctQ0PXuMYHtOCJnsd3_JmQ78DlI2LjBaB469C51frUCoHKobsO1r37yE19xYd-PN44ejejrq5s9uw3WiuX1BsK6M8OFVR0V575DrPzpXjaOKdM4"/>
</div>
</div>
</header>
<div class="p-8 flex-1">
<!-- Overview Section: Bento Grid -->
<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
<!-- Metric 1 -->
<div class="bg-surface-container-low p-6 rounded-xl group hover:bg-surface-container transition-colors border border-white/5">
<p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-4 font-bold">TOTAL DE LLAMADAS</p>
<div class="flex items-end justify-between">
<h3 class="font-headline text-4xl font-extrabold text-on-surface tracking-tighter">14,208</h3>
<span class="text-primary text-xs font-bold flex items-center gap-1 mb-1">
<span class="material-symbols-outlined text-sm" data-icon="trending_up">trending_up</span>
              +12.4%
            </span>
</div>
<div class="mt-4 w-full h-1 bg-surface-container-high rounded-full overflow-hidden">
<div class="h-full bg-primary w-[75%] rounded-full"></div>
</div>
</div>
<!-- Metric 2 -->
<div class="bg-surface-container-low p-6 rounded-xl group hover:bg-surface-container transition-colors border border-white/5">
<p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-4 font-bold">PROMEDIO TIEMPO AL AIRE</p>
<div class="flex items-end justify-between">
<h3 class="font-headline text-4xl font-extrabold text-on-surface tracking-tighter">04:12</h3>
<span class="text-tertiary text-xs font-bold flex items-center gap-1 mb-1">
<span class="material-symbols-outlined text-sm" data-icon="trending_down">trending_down</span>
              -2.1%
            </span>
</div>
<div class="mt-4 w-full h-1 bg-surface-container-high rounded-full overflow-hidden">
<div class="h-full bg-primary w-[40%] rounded-full opacity-60"></div>
</div>
</div>
<!-- Metric 3 -->
<div class="bg-surface-container-low p-6 rounded-xl group hover:bg-surface-container transition-colors border border-white/5">
<p class="text-[10px] uppercase tracking-[0.2em] text-on-surface-variant mb-4 font-bold">TIEMPO MUERTO TOTAL</p>
<div class="flex items-end justify-between">
<h3 class="font-headline text-4xl font-extrabold text-on-surface tracking-tighter">58:02</h3>
<span class="text-on-surface-variant text-xs font-bold flex items-center gap-1 mb-1 uppercase tracking-widest">Estable</span>
</div>
<div class="mt-4 w-full h-1 bg-surface-container-high rounded-full overflow-hidden">
<div class="h-full bg-tertiary-container w-[15%] rounded-full"></div>
</div>
</div>
</div>
<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
<!-- Main Chart Section (2/3 width) -->
<div class="lg:col-span-2 space-y-8">
<div class="bg-surface-container-low p-8 rounded-xl border border-white/5">
<div class="flex justify-between items-start mb-12">
<div>
<h4 class="font-headline font-bold text-xl text-on-surface">Volumen de Llamadas en el Tiempo</h4>
<p class="text-xs text-on-surface-variant mt-1">Telemetría en vivo para nodos de terminal activos</p>
</div>
<div class="flex gap-2">
<button class="px-3 py-1 rounded bg-surface-container-high text-[10px] font-bold uppercase tracking-widest text-primary border border-primary/20">En Vivo</button>
<button class="px-3 py-1 rounded bg-transparent text-[10px] font-bold uppercase tracking-widest text-on-surface-variant hover:bg-surface-container-high transition-colors">24H</button>
</div>
</div>
<!-- Abstract Chart Visual -->
<div class="h-[300px] w-full relative flex items-end gap-1 px-2">
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[30%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[45%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[35%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[60%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[85%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[70%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[55%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[40%]"></div>
<div class="flex-1 bg-primary/20 hover:bg-primary/30 transition-all rounded-t-sm h-[90%] border-t-2 border-primary glow-primary"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[65%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[50%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[75%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[40%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[30%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[55%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[80%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[95%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[60%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[45%]"></div>
<div class="flex-1 bg-primary/10 hover:bg-primary/30 transition-all rounded-t-sm h-[30%]"></div>
<!-- Timeline labels -->
<div class="absolute bottom-[-24px] left-0 right-0 flex justify-between text-[10px] text-on-surface-variant font-medium">
<span>08:00</span>
<span>12:00</span>
<span>16:00</span>
<span>20:00</span>
<span>00:00</span>
</div>
</div>
</div>
<!-- Active Alerts / Logs -->
<div class="bg-surface-container-low rounded-xl border border-white/5 overflow-hidden">
<div class="px-8 py-4 bg-surface-container border-b border-white/5 flex justify-between items-center">
<h4 class="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Registros de Actividad del Sistema</h4>
<span class="material-symbols-outlined text-primary/50 text-sm" data-icon="filter_list">filter_list</span>
</div>
<div class="p-2">
<div class="flex items-center gap-4 px-6 py-4 hover:bg-surface-container transition-colors rounded-lg group">
<span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
<span class="text-[10px] font-mono text-primary/60">14:02:11</span>
<span class="text-sm font-medium">Reporte generado para Terminal #02-A</span>
<span class="ml-auto text-[10px] bg-primary/10 text-primary px-2 py-1 rounded font-bold uppercase">Éxito</span>
</div>
<div class="flex items-center gap-4 px-6 py-4 hover:bg-surface-container transition-colors rounded-lg group">
<span class="w-1.5 h-1.5 rounded-full bg-tertiary"></span>
<span class="text-[10px] font-mono text-primary/60">13:58:45</span>
<span class="text-sm font-medium">Alta latencia detectada en Cola de Asesores B</span>
<span class="ml-auto text-[10px] bg-tertiary/10 text-tertiary px-2 py-1 rounded font-bold uppercase">Advertencia</span>
</div>
<div class="flex items-center gap-4 px-6 py-4 hover:bg-surface-container transition-colors rounded-lg group">
<span class="w-1.5 h-1.5 rounded-full bg-primary"></span>
<span class="text-[10px] font-mono text-primary/60">13:45:22</span>
<span class="text-sm font-medium">Asesor "Marcos P." cambió a estado DESCANSO</span>
<span class="ml-auto text-[10px] bg-surface-container-high text-on-surface-variant px-2 py-1 rounded font-bold uppercase">Actualización</span>
</div>
</div>
</div>
</div>
<!-- Advisors Status (1/3 width) -->
<div class="space-y-6">
<div class="bg-surface-container-low rounded-xl border border-white/5 h-full flex flex-col overflow-hidden">
<div class="p-6 border-b border-white/5">
<h4 class="font-headline font-bold text-lg mb-4">Monitor de Asesores</h4>
<div class="flex gap-4">
<div class="flex-1 bg-surface-container-high p-3 rounded-lg text-center">
<p class="text-[10px] uppercase font-bold text-primary mb-1">Activos</p>
<p class="text-xl font-black">24</p>
</div>
<div class="flex-1 bg-surface-container-high p-3 rounded-lg text-center">
<p class="text-[10px] uppercase font-bold text-tertiary mb-1">Descanso</p>
<p class="text-xl font-black">06</p>
</div>
</div>
</div>
<div class="flex-1 overflow-y-auto custom-scrollbar p-2">
<!-- Advisor List -->
<div class="space-y-1">
<!-- Advisor 1 -->
<div class="flex items-center gap-4 p-4 rounded-lg hover:bg-surface-container transition-all group">
<div class="relative">
<img alt="Advisor" class="w-10 h-10 rounded-lg bg-surface-container-highest" data-alt="Avatar of male tech advisor" src="https://lh3.googleusercontent.com/aida-public/AB6AXuD3Dl9e9FAyjxYU52Ab4v12lKcjQlX7BN3gd-lv1oA3wP6m9NV3WgYQ3rus6BlqQp21B1Emymh_6TRfH-ZKnUBBrEuSIU_2YwJOoTbX-gEp1TavxR9IK71nH8y5JsyNwYBEhXbkheT8eXY26oRF__06eDq2CFC8aCdW-RkJtYgH53OWtH2-t_oZkm0Kf4cJ3BfMv8Z3dcAWDPt1ULIumRhTZyPwmo2Bc1TYqoHg2ROAFhaMh85RQy1H96FJ60DPZd5kvStwOzkBZgM"/>
<div class="absolute -bottom-1 -right-1 w-3 h-3 bg-primary border-2 border-surface-container-low rounded-full"></div>
</div>
<div>
<p class="text-sm font-bold">Roberto Méndez</p>
<p class="text-[10px] text-on-surface-variant uppercase tracking-tighter">En Llamada</p>
</div>
<span class="ml-auto material-symbols-outlined text-on-surface-variant group-hover:text-primary cursor-pointer text-lg" data-icon="monitoring">monitoring</span>
</div>
<!-- Advisor 2 -->
<div class="flex items-center gap-4 p-4 rounded-lg hover:bg-surface-container transition-all group">
<div class="relative">
<img alt="Advisor" class="w-10 h-10 rounded-lg bg-surface-container-highest" data-alt="Avatar of female tech advisor" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDHQQqPvlUlFq68sQym7ZWC2SObGaBmoFLx_FWs8sWTssudG9W_tFER7vbPkeER7IQNOnHIC2VuiRmFHA4_X9XDg6a4j_5VyEFB5M6uUOL2LbslMkoqnCOr9XuOxZmqYhVt35t_iPcj-kI5ILlYrNfMojEn09RUS0TGqjQyKbmB4EuBK45zuVQumWtF6PdGazvO_bs0rWRSoKW__BzKEFdIGd1Sv-BmKuCqU-TJSP69TU3C8BTt_b8sY7kt-e1H7PYp1rwPrAxJcm4"/>
<div class="absolute -bottom-1 -right-1 w-3 h-3 bg-primary border-2 border-surface-container-low rounded-full"></div>
</div>
<div>
<p class="text-sm font-bold">Elena Rivas</p>
<p class="text-[10px] text-on-surface-variant uppercase tracking-tighter">Disponible</p>
</div>
<span class="ml-auto material-symbols-outlined text-on-surface-variant group-hover:text-primary cursor-pointer text-lg" data-icon="monitoring">monitoring</span>
</div>
<!-- Advisor 3 -->
<div class="flex items-center gap-4 p-4 rounded-lg hover:bg-surface-container transition-all group bg-surface-container-high/30">
<div class="relative">
<img alt="Advisor" class="w-10 h-10 rounded-lg bg-surface-container-highest" data-alt="Generic silhouette avatar" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDbe1eZ0JcIhqF4VSzSXT4aapXnsQp0KtI3AXxs6rAqmvIcspai-YyAy-7MFN1BxxQQH5rGwGYgRnxtSJVZSwcDihc7-VpULoV-oaeYLzqBMtL5l_RiJwZ_fYRNPEsCN7Up5xxXwoRZkFZwbd5vfBxrobsyfebkS35zV4m4gNEnUXIU7L-iE7oHry48vEJMmn87h0Ra5ohY9fKlYUfEPd89EaMT2LJDtlmoKVOoXoeCCdpudu-aqwVpmr47jXEeKBWr5rqQCNUppLk"/>
<div class="absolute -bottom-1 -right-1 w-3 h-3 bg-tertiary border-2 border-surface-container-low rounded-full"></div>
</div>
<div>
<p class="text-sm font-bold text-on-surface-variant">Marcos Pozzo</p>
<p class="text-[10px] text-tertiary uppercase tracking-tighter">En Descanso</p>
</div>
<span class="ml-auto material-symbols-outlined text-on-surface-variant group-hover:text-primary cursor-pointer text-lg" data-icon="monitoring">monitoring</span>
</div>
<!-- Advisor 4 -->
<div class="flex items-center gap-4 p-4 rounded-lg hover:bg-surface-container transition-all group">
<div class="relative">
<img alt="Advisor" class="w-10 h-10 rounded-lg bg-surface-container-highest" data-alt="Avatar of female business advisor" src="https://lh3.googleusercontent.com/aida-public/AB6AXuC6mckesXdz1lmM6pQj682Fl4hFkuST8QDgaoC_-0hMDTwr1BtZq1N1lX34vzdtqUxnTVHa4_1degcOTA-FQJYuKmpovd5yV8fFjzVKMom69XL16jsgy6M-QH5bwEQYmCxukL6TiVC0ZlijKMP4QmT1XgWlNS-GNKoV85zdiBzaf7F8E0U0fs1I8xIseBlUkjlBSKgn8I3CLbnHkQ5i3TrQuSMwGKHtDZmxNXft5fnsvpDN_tZVFVd56xqDF_a6TcKfDO6VcWHbdkI"/>
<div class="absolute -bottom-1 -right-1 w-3 h-3 bg-primary border-2 border-surface-container-low rounded-full"></div>
</div>
<div>
<p class="text-sm font-bold">Julia Torres</p>
<p class="text-[10px] text-on-surface-variant uppercase tracking-tighter">Cierre</p>
</div>
<span class="ml-auto material-symbols-outlined text-on-surface-variant group-hover:text-primary cursor-pointer text-lg" data-icon="monitoring">monitoring</span>
</div>
<!-- Advisor 5 -->
<div class="flex items-center gap-4 p-4 rounded-lg hover:bg-surface-container transition-all group">
<div class="relative">
<img alt="Advisor" class="w-10 h-10 rounded-lg bg-surface-container-highest" data-alt="Avatar of male business advisor" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCwiHDAt3GsEGAX8xAzzokrGejddNAgGpdS5BtBNX3uE8koFqbZsCHjwDYZcDhkv4Lr3DfVRyLjxcCvspf5adO50qmPOZyNLhXgq21sgMhECSr_D9nV84U8z6yweN6eR4YuAzqLiKYTRKvktdUBEYfnh7UqdliT3EtGtiRoul9s_w-da8ren6Pk1o1Q0GzK8GasyE3JV4oSYreDMar1RtYSw3Y4XrNo-oi_67NKa6_Qj1LliXmUsmSph3bT-zvWbOZ0xY0r_ri4N8c"/>
<div class="absolute -bottom-1 -right-1 w-3 h-3 bg-primary border-2 border-surface-container-low rounded-full"></div>
</div>
<div>
<p class="text-sm font-bold">Daniel Soto</p>
<p class="text-[10px] text-on-surface-variant uppercase tracking-tighter">En Llamada</p>
</div>
<span class="ml-auto material-symbols-outlined text-on-surface-variant group-hover:text-primary cursor-pointer text-lg" data-icon="monitoring">monitoring</span>
</div>
</div>
</div>
<div class="p-6 bg-surface-container-high/20 border-t border-white/5">
<button class="w-full py-3 rounded-lg border border-primary/20 text-primary text-[10px] font-bold uppercase tracking-widest hover:bg-primary/5 transition-colors">Ver Nómina Completa</button>
</div>
</div>
</div>
</div>
</div>
<!-- Bottom Navigation Bar (Mobile specific visible/Responsive sync) -->
<nav class="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center pb-safe h-16 bg-[#131313]/80 backdrop-blur-xl border-t border-white/5 shadow-[0_-4px_20px_rgba(0,0,0,0.5)]">
<a class="flex flex-col items-center justify-center text-[#54e98a] drop-shadow-[0_0_8px_rgba(84,233,138,0.5)]" href="#">
<span class="material-symbols-outlined" data-icon="usb">usb</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest">USB Connect</span>
</a>
<a class="flex flex-col items-center justify-center text-gray-600" href="#">
<span class="material-symbols-outlined" data-icon="wifi">wifi</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest">WIFI Sync</span>
</a>
<a class="flex flex-col items-center justify-center text-gray-600" href="#">
<span class="material-symbols-outlined" data-icon="sensors">sensors</span>
<span class="font-['Inter'] text-[10px] uppercase tracking-widest">Status</span>
</a>
</nav>
</main>
<!-- Floating Status Indicator (Bespoke interaction point) -->
<div class="fixed bottom-8 right-8 z-50 bg-[#1c1b1b]/60 backdrop-blur-xl border border-white/10 px-6 py-4 rounded-full flex items-center gap-6 shadow-2xl">
<div class="flex items-center gap-3">
<div class="flex flex-col">
<span class="text-[10px] uppercase tracking-widest text-on-surface-variant leading-none font-bold">Terminal Seguro</span>
<span class="text-xs text-primary font-bold">98.2%</span>
</div>
<div class="w-24 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
<div class="h-full bg-primary w-[98%]"></div>
</div>
</div>
<div class="flex items-center gap-2 border-l border-white/10 pl-6">
<span class="material-symbols-outlined text-primary text-xl" data-icon="cloud_sync" data-weight="fill" style="font-variation-settings: 'FILL' 1;">cloud_sync</span>
<span class="text-[10px] uppercase tracking-widest font-bold">ENCRIPTADO</span>
</div>
</div>
</body></html>

<!-- Panel Supervisor: Dashboard -->
<!DOCTYPE html>

<html class="dark" lang="es"><head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>Precision Terminal - Reports &amp; Analytics</title>
<script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;700;800&amp;family=Inter:wght@400;500;600&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&amp;display=swap" rel="stylesheet"/>
<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        "secondary-fixed-dim": "#9ad4a5",
                        "primary-fixed": "#6bfe9c",
                        "primary": "#54e98a",
                        "on-error-container": "#ffdad6",
                        "outline-variant": "#3d4a3e",
                        "primary-container": "#2ecc71",
                        "surface-container": "#201f1f",
                        "surface-container-lowest": "#0e0e0e",
                        "on-secondary-fixed-variant": "#19512d",
                        "on-secondary-fixed": "#00210c",
                        "on-primary-fixed-variant": "#005228",
                        "outline": "#869486",
                        "on-secondary-container": "#89c294",
                        "surface-bright": "#393939",
                        "inverse-primary": "#006d37",
                        "on-tertiary-fixed": "#390c00",
                        "surface-container-high": "#2a2a2a",
                        "on-primary": "#003919",
                        "primary-fixed-dim": "#4ae183",
                        "surface-container-low": "#1c1b1b",
                        "secondary-fixed": "#b5f1c0",
                        "surface-variant": "#353534",
                        "on-surface": "#e5e2e1",
                        "on-background": "#e5e2e1",
                        "secondary": "#9ad4a5",
                        "inverse-surface": "#e5e2e1",
                        "surface-tint": "#4ae183",
                        "surface": "#131313",
                        "on-error": "#690005",
                        "surface-dim": "#131313",
                        "error-container": "#93000a",
                        "tertiary-container": "#ff9875",
                        "on-tertiary-container": "#772e14",
                        "error": "#ffb4ab",
                        "on-tertiary": "#5b1a02",
                        "on-primary-fixed": "#00210c",
                        "on-tertiary-fixed-variant": "#793015",
                        "on-surface-variant": "#bbcbbb",
                        "background": "#131313",
                        "tertiary-fixed-dim": "#ffb59d",
                        "on-secondary": "#003919",
                        "on-primary-container": "#005027",
                        "surface-container-highest": "#353534",
                        "secondary-container": "#19512d",
                        "inverse-on-surface": "#313030",
                        "tertiary-fixed": "#ffdbd0",
                        "tertiary": "#ffc0ac"
                    },
                    fontFamily: {
                        "headline": ["Manrope"],
                        "body": ["Inter"],
                        "label": ["Inter"]
                    },
                    borderRadius: {"DEFAULT": "0.125rem", "lg": "0.25rem", "xl": "0.5rem", "full": "0.75rem"},
                },
            },
        }
    </script>
<style>
        .material-symbols-outlined {
            font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
        }
        body {
            font-family: 'Inter', sans-serif;
            background-color: #131313;
            color: #e5e2e1;
        }
        .custom-scrollbar::-webkit-scrollbar {
            width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
            background: #131313;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
            background: #353534;
            border-radius: 10px;
        }
    </style>
<style>
    body {
      min-height: max(884px, 100dvh);
    }
  </style>
</head>
<body class="bg-background text-on-background min-h-screen flex flex-col">
<!-- TopAppBar -->
<header class="bg-[#131313] dark:bg-[#131313] flex justify-between items-center px-8 h-20 w-full docked full-width top-0 z-50">
<div class="flex items-center gap-4">
<span class="material-symbols-outlined text-[#54e98a]" data-icon="terminal">terminal</span>
<h1 class="font-['Manrope'] font-black tracking-tighter text-[#54e98a] uppercase text-2xl">PRECISION TERMINAL</h1>
</div>
<nav class="hidden md:flex items-center space-x-8">
<a class="text-gray-500 hover:bg-[#2a2a2a] transition-colors px-3 py-2 rounded font-['Inter'] font-medium text-sm" href="#">Dashboard</a>
<a class="text-gray-500 hover:bg-[#2a2a2a] transition-colors px-3 py-2 rounded font-['Inter'] font-medium text-sm" href="#">Advisor Console</a>
<a class="text-[#54e98a] border-b-2 border-[#54e98a] px-3 py-2 font-['Inter'] font-bold text-sm" href="#">Supervisor Logs</a>
<a class="text-gray-500 hover:bg-[#2a2a2a] transition-colors px-3 py-2 rounded font-['Inter'] font-medium text-sm" href="#">System Config</a>
</nav>
<div class="flex items-center gap-3">
<div class="text-right hidden sm:block">
<p class="text-xs font-bold text-[#54e98a]">SUPERVISOR</p>
<p class="text-[10px] text-gray-500">ID: 8829-QX</p>
</div>
<img alt="Profile" class="w-10 h-10 rounded-full bg-surface-container-high border border-outline-variant/30" data-alt="Supervisor user profile avatar silhouette" src="https://lh3.googleusercontent.com/aida-public/AB6AXuA6oJm_xGZ_51qCQIoMf5zadRbWO-75AhWj1qDjf4GqraOIvfMYLd2oOVnNwmY31ALKkHynPrK3pRGu88PSc3yn3gSXcgMr26IVPSaWxHCZCkw5a_c3RfcBO3AriCPEAHWyXhWkowHxvrVTvYWBySa7F7TJc4vLxJRT0w8822DLN-cnO9JkMaMZwxviMQXoMdI2-YZwsKnMclA4mxm6CwmoNpmEcgi1WhzNh7LIcEC9fvN5NKEL0bmtreYHC93XG8btxw9zEM9tCq4"/>
</div>
</header>
<div class="flex flex-1 overflow-hidden">
<!-- NavigationDrawer -->
<aside class="hidden lg:flex flex-col bg-[#1c1b1b] dark:bg-[#1c1b1b] w-72 h-full py-6 z-40 shadow-2xl shadow-black/50 transition-all duration-300 ease-in-out">
<div class="px-6 mb-8">
<p class="font-['Manrope'] font-bold text-[#54e98a] tracking-widest text-xs uppercase">TERMINAL ROLE</p>
</div>
<nav class="flex flex-col gap-1">
<a class="text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-3 font-['Inter'] font-medium text-sm hover:bg-[#2a2a2a] rounded-lg transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="dashboard">dashboard</span>
                    Dashboard
                </a>
<a class="text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-3 font-['Inter'] font-medium text-sm hover:bg-[#2a2a2a] rounded-lg transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="operator_licence">license</span>
                    Advisor Console
                </a>
<a class="bg-gradient-to-br from-[#54e98a] to-[#2ecc71] text-[#131313] font-bold rounded-lg mx-2 px-4 py-3 flex items-center gap-3 font-['Inter'] text-sm shadow-lg shadow-primary/20" href="#">
<span class="material-symbols-outlined" data-icon="analytics">analytics</span>
                    Supervisor Logs
                </a>
<a class="text-gray-400 hover:text-white px-4 py-3 mx-2 flex items-center gap-3 font-['Inter'] font-medium text-sm hover:bg-[#2a2a2a] rounded-lg transition-colors" href="#">
<span class="material-symbols-outlined" data-icon="settings_input_component">settings_input_component</span>
                    System Config
                </a>
</nav>
<div class="mt-auto px-6 py-4">
<div class="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10">
<p class="text-[10px] text-primary/60 uppercase tracking-tighter mb-1">System Load</p>
<div class="h-1 w-full bg-surface-container-high rounded-full overflow-hidden">
<div class="h-full bg-primary w-[32%]"></div>
</div>
</div>
</div>
</aside>
<!-- Main Content Canvas -->
<main class="flex-1 overflow-y-auto custom-scrollbar bg-surface p-8 lg:p-14">
<!-- Header Section -->
<section class="mb-12 flex flex-col md:flex-row md:items-end justify-between gap-6">
<div>
<h2 class="font-headline font-extrabold text-4xl tracking-tight text-on-surface mb-2">Reportes y Análisis</h2>
<p class="text-on-surface-variant font-body max-w-xl">Monitoree la eficiencia operativa mediante la extracción granular de datos. Filtre por parámetros de métricas y genere exportaciones de precisión.</p>
</div>
<div class="flex gap-4">
<div class="bg-surface-container-low px-4 py-2 rounded-xl flex items-center gap-3 border border-outline-variant/5">
<span class="relative flex h-2 w-2">
<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
<span class="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
</span>
<span class="text-xs font-label uppercase tracking-widest text-on-surface-variant">Telemetría en Vivo Activa</span>
</div>
</div>
</section>
<!-- Bento Grid Layout -->
<div class="grid grid-cols-12 gap-6">
<!-- Filter Panel -->
<div class="col-span-12 lg:col-span-4 flex flex-col gap-6">
<!-- Date Selection Card -->
<div class="bg-surface-container-low p-6 rounded-xl border border-outline-variant/10">
<h3 class="font-headline font-bold text-sm uppercase tracking-widest text-primary mb-6">Rango Temporal</h3>
<div class="space-y-4">
<div>
<label class="text-[10px] text-on-surface-variant uppercase font-bold mb-2 block">Fecha de Inicio</label>
<input class="w-full bg-surface-container p-3 rounded-lg border-none text-on-surface focus:ring-1 focus:ring-primary text-sm font-body" type="date"/>
</div>
<div>
<label class="text-[10px] text-on-surface-variant uppercase font-bold mb-2 block">Fecha de Fin</label>
<input class="w-full bg-surface-container p-3 rounded-lg border-none text-on-surface focus:ring-1 focus:ring-primary text-sm font-body" type="date"/>
</div>
</div>
</div>
<!-- Report Types Card -->
<div class="bg-surface-container-high p-6 rounded-xl shadow-2xl shadow-black/40">
<h3 class="font-headline font-bold text-sm uppercase tracking-widest text-primary mb-6">Dimensiones del Reporte</h3>
<div class="space-y-3">
<label class="flex items-center justify-between p-3 rounded-lg hover:bg-surface-container-highest transition-colors cursor-pointer group">
<span class="text-sm font-body text-on-surface group-hover:text-primary transition-colors">Productividad</span>
<input checked="" class="rounded border-none bg-surface-container-lowest text-primary focus:ring-0 focus:ring-offset-0 w-5 h-5" type="checkbox"/>
</label>
<label class="flex items-center justify-between p-3 rounded-lg hover:bg-surface-container-highest transition-colors cursor-pointer group">
<span class="text-sm font-body text-on-surface group-hover:text-primary transition-colors">Tiempos Muertos</span>
<input class="rounded border-none bg-surface-container-lowest text-primary focus:ring-0 focus:ring-offset-0 w-5 h-5" type="checkbox"/>
</label>
<label class="flex items-center justify-between p-3 rounded-lg hover:bg-surface-container-highest transition-colors cursor-pointer group">
<span class="text-sm font-body text-on-surface group-hover:text-primary transition-colors">Calidad de Llamada</span>
<input checked="" class="rounded border-none bg-surface-container-lowest text-primary focus:ring-0 focus:ring-offset-0 w-5 h-5" type="checkbox"/>
</label>
</div>
</div>
<!-- Action Button -->
<button class="w-full bg-gradient-to-br from-[#54e98a] to-[#2ecc71] py-5 rounded-xl text-[#131313] font-headline font-extrabold text-lg uppercase tracking-tight flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-primary/20">
<span class="material-symbols-outlined" data-icon="file_download">file_download</span>
                        Generar Reporte
                        <span class="text-[10px] opacity-60 font-body">(PDF/EXCEL)</span>
</button>
</div>
<!-- Table Preview Section -->
<div class="col-span-12 lg:col-span-8">
<div class="bg-surface-container-low rounded-xl overflow-hidden flex flex-col h-full border border-outline-variant/10">
<div class="p-6 flex items-center justify-between bg-surface-container-lowest/50">
<div>
<h3 class="font-headline font-bold text-sm uppercase tracking-widest text-on-surface">Vista Previa de Datos</h3>
<p class="text-[10px] text-on-surface-variant font-body">Mostrando telemetría operativa de las últimas 24h</p>
</div>
<div class="flex gap-2">
<button class="p-2 bg-surface-container rounded-lg text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined text-sm" data-icon="refresh">refresh</span>
</button>
<button class="p-2 bg-surface-container rounded-lg text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined text-sm" data-icon="more_vert">more_vert</span>
</button>
</div>
</div>
<div class="overflow-x-auto flex-1">
<table class="w-full text-left border-collapse">
<thead class="bg-surface-container-lowest/30">
<tr>
<th class="p-5 font-headline font-bold text-[10px] uppercase tracking-widest text-primary/70">ID de Asesor</th>
<th class="p-5 font-headline font-bold text-[10px] uppercase tracking-widest text-primary/70">Métricas</th>
<th class="p-5 font-headline font-bold text-[10px] uppercase tracking-widest text-primary/70">Estado</th>
<th class="p-5 font-headline font-bold text-[10px] uppercase tracking-widest text-primary/70 text-right">Tiempo Prom.</th>
</tr>
</thead>
<tbody class="divide-y divide-outline-variant/5">
<!-- Row 1 -->
<tr class="hover:bg-surface-container-high/50 transition-colors group">
<td class="p-5">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-[10px] font-bold text-on-surface-variant">01</div>
<div>
<p class="text-sm font-bold text-on-surface">M. VALENCIA</p>
<p class="text-[10px] text-on-surface-variant uppercase">Senior Advisor</p>
</div>
</div>
</td>
<td class="p-5">
<div class="flex gap-2">
<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">98% CAL</span>
<span class="px-2 py-0.5 rounded-full bg-tertiary-container/10 text-tertiary-container text-[10px] font-bold">12% IDLE</span>
</div>
</td>
<td class="p-5">
<div class="flex items-center gap-2">
<div class="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_#54e98a]"></div>
<span class="text-[10px] font-bold uppercase text-on-surface-variant">Connected</span>
</div>
</td>
<td class="p-5 text-right font-mono text-sm text-[#54e98a]">04:12:44</td>
</tr>
<!-- Row 2 -->
<tr class="hover:bg-surface-container-high/50 transition-colors group">
<td class="p-5">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-[10px] font-bold text-on-surface-variant">02</div>
<div>
<p class="text-sm font-bold text-on-surface">L. CASTRO</p>
<p class="text-[10px] text-on-surface-variant uppercase">Junior Console</p>
</div>
</div>
</td>
<td class="p-5">
<div class="flex gap-2">
<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">85% CAL</span>
<span class="px-2 py-0.5 rounded-full bg-error-container/10 text-error text-[10px] font-bold">28% IDLE</span>
</div>
</td>
<td class="p-5">
<div class="flex items-center gap-2">
<div class="h-1.5 w-1.5 rounded-full bg-tertiary shadow-[0_0_8px_#ffc0ac]"></div>
<span class="text-[10px] font-bold uppercase text-on-surface-variant">Idle State</span>
</div>
</td>
<td class="p-5 text-right font-mono text-sm text-[#54e98a]">06:05:12</td>
</tr>
<!-- Row 3 -->
<tr class="hover:bg-surface-container-high/50 transition-colors group">
<td class="p-5">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-[10px] font-bold text-on-surface-variant">03</div>
<div>
<p class="text-sm font-bold text-on-surface">K. REYES</p>
<p class="text-[10px] text-on-surface-variant uppercase">Senior Advisor</p>
</div>
</div>
</td>
<td class="p-5">
<div class="flex gap-2">
<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">92% CAL</span>
<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">5% IDLE</span>
</div>
</td>
<td class="p-5">
<div class="flex items-center gap-2">
<div class="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_#54e98a]"></div>
<span class="text-[10px] font-bold uppercase text-on-surface-variant">Connected</span>
</div>
</td>
<td class="p-5 text-right font-mono text-sm text-[#54e98a]">02:45:10</td>
</tr>
<!-- Row 4 -->
<tr class="hover:bg-surface-container-high/50 transition-colors group border-none">
<td class="p-5">
<div class="flex items-center gap-3">
<div class="w-8 h-8 rounded bg-surface-container flex items-center justify-center text-[10px] font-bold text-on-surface-variant">04</div>
<div>
<p class="text-sm font-bold text-on-surface">J. MORALES</p>
<p class="text-[10px] text-on-surface-variant uppercase">Senior Advisor</p>
</div>
</div>
</td>
<td class="p-5">
<div class="flex gap-2">
<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">99% CAL</span>
<span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">2% IDLE</span>
</div>
</td>
<td class="p-5">
<div class="flex items-center gap-2">
<div class="h-1.5 w-1.5 rounded-full bg-error shadow-[0_0_8px_#ffb4ab]"></div>
<span class="text-[10px] font-bold uppercase text-on-surface-variant">Disconnected</span>
</div>
</td>
<td class="p-5 text-right font-mono text-sm text-[#54e98a]">00:00:00</td>
</tr>
</tbody>
</table>
</div>
<!-- Table Footer / Pagination -->
<div class="p-6 bg-surface-container-lowest/50 border-t border-outline-variant/10 flex items-center justify-between">
<span class="text-[10px] font-label text-on-surface-variant uppercase tracking-widest">Mostrando 4 de 128 nodos activos</span>
<div class="flex gap-4">
<button class="text-on-surface-variant hover:text-primary transition-colors">
<span class="material-symbols-outlined" data-icon="chevron_left">chevron_left</span>
</button>
<button class="text-primary">
<span class="material-symbols-outlined" data-icon="chevron_right">chevron_right</span>
</button>
</div>
</div>
</div>
</div>
<!-- Small Analytics Cards (Bottom Row) -->
<div class="col-span-12 md:col-span-4 lg:col-span-3">
<div class="bg-surface-container-high p-6 rounded-xl border border-outline-variant/5">
<div class="flex justify-between items-start mb-4">
<span class="material-symbols-outlined text-primary" data-icon="timer">timer</span>
<span class="text-[10px] font-bold text-primary bg-primary/10 px-2 py-0.5 rounded-full">+12%</span>
</div>
<p class="text-xs text-on-surface-variant uppercase font-bold tracking-tighter mb-1">Tiempo Promedio de Conversación</p>
<p class="text-2xl font-headline font-extrabold text-on-surface">06:42<span class="text-sm font-normal text-on-surface-variant ml-1">m</span></p>
</div>
</div>
<div class="col-span-12 md:col-span-4 lg:col-span-3">
<div class="bg-surface-container-low p-6 rounded-xl border border-outline-variant/5">
<div class="flex justify-between items-start mb-4">
<span class="material-symbols-outlined text-tertiary" data-icon="troubleshoot">troubleshoot</span>
<span class="text-[10px] font-bold text-tertiary bg-tertiary/10 px-2 py-0.5 rounded-full">-3.4%</span>
</div>
<p class="text-xs text-on-surface-variant uppercase font-bold tracking-tighter mb-1">Tiempo Muerto Total</p>
<p class="text-2xl font-headline font-extrabold text-on-surface">14:28<span class="text-sm font-normal text-on-surface-variant ml-1">h</span></p>
</div>
</div>
<div class="col-span-12 md:col-span-4 lg:col-span-6">
<div class="bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/10 flex items-center justify-between">
<div class="flex-1">
<h4 class="text-sm font-headline font-bold text-on-surface mb-1">Rastro de Auditoría Activo</h4>
<p class="text-[10px] text-on-surface-variant font-body">La generación de reportes se está registrando para cumplimiento ISO-9001.</p>
</div>
<div class="h-12 w-12 bg-surface-container-high rounded-full flex items-center justify-center border border-primary/20">
<span class="material-symbols-outlined text-primary" data-icon="verified_user" style="font-variation-settings: 'FILL' 1;">verified_user</span>
</div>
</div>
</div>
</div>
</main>
</div>
<!-- BottomNavBar (Mobile Only) -->
<footer class="md:hidden bg-[#131313]/80 backdrop-blur-xl fixed bottom-0 left-0 w-full h-16 border-t border-white/5 z-50 flex justify-around items-center pb-safe">
<a class="flex flex-col items-center justify-center text-gray-600 hover:text-[#54e98a]/80 active:scale-90 transition-transform" href="#">
<span class="material-symbols-outlined" data-icon="usb">usb</span>
<span class="font-['Inter'] text-[8px] uppercase tracking-widest mt-1">USB Connect</span>
</a>
<a class="flex flex-col items-center justify-center text-gray-600 hover:text-[#54e98a]/80 active:scale-90 transition-transform" href="#">
<span class="material-symbols-outlined" data-icon="wifi">wifi</span>
<span class="font-['Inter'] text-[8px] uppercase tracking-widest mt-1">WIFI Sync</span>
</a>
<a class="flex flex-col items-center justify-center text-[#54e98a] drop-shadow-[0_0_8px_rgba(84,233,138,0.5)] active:scale-90 transition-transform" href="#">
<span class="material-symbols-outlined" data-icon="sensors">sensors</span>
<span class="font-['Inter'] text-[8px] uppercase tracking-widest mt-1">Status</span>
</a>
</footer>
</body></html>

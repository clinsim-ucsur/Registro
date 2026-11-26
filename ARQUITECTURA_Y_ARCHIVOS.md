# 🏛️ Arquitectura y Esquema Completo de Archivos del Proyecto (`registro-app`)

**Sistema de Gestión y Registro Digital de Asistencia — Clínica de Simulación (ClinSim UCSUR)**  
*Universidad Científica del Sur*

---

## 🌳 1. Árbol General de Carpetas y Archivos

```text
registro/
├── prisma/
│   └── schema.prisma                      # Esquema de base de datos PostgreSQL (Modelos y Enums)
├── public/
│   ├── sw.js                              # Service Worker (Notificaciones Push con app cerrada / pantalla bloqueada)
│   ├── manuales/                          # 5 Manuales PDF oficiales por rol (descargables desde el Dashboard)
│   │   ├── 1_Manual_Usuario_Final_Marcacion_Asistencia.pdf
│   │   ├── 2_Manual_Super_Admin_Acceso_Total.pdf
│   │   ├── 3_Manual_Admin_General_Multisede.pdf
│   │   ├── 4_Manual_Admin_Por_Sede.pdf
│   │   └── 5_Manual_Coordinador_Pacientes_Simulados.pdf
│   ├── manuals/
│   │   └── Guia_Instalacion_App_Celular_UCSUR.pdf # Guía visual PDF para instalar la app en Android y iPhone
│   └── templates/                         # Plantillas Excel (.xlsx) para carga masiva de personal
│       ├── plantilla_docentes.xlsx
│       ├── plantilla_pacientes.xlsx
│       └── plantilla_tecnicos.xlsx
├── docs/                                  # Documentación y respaldos de manuales PDF y guías
├── scripts/
│   ├── generate-manual.ts                 # Generador automatizado de los manuales PDF con jsPDF
│   └── test-all-features.ts               # Suite de 108 pruebas automatizadas del sistema
├── src/
│   ├── middleware.ts                      # Protección de rutas (/dashboard y /login) según sesión activa
│   ├── app/                               # Rutas y páginas de Next.js (App Router)
│   │   ├── layout.tsx                     # Layout raíz (fuentes, metadatos PWA y notificaciones Toast)
│   │   ├── page.tsx                       # Página principal: Portal Público de Registro de Asistencia
│   │   ├── manifest.ts                    # Manifiesto PWA (permite instalar la web como aplicativo móvil)
│   │   ├── globals.css                    # Estilos globales y configuración de Tailwind CSS v4
│   │   ├── favicon.ico                    # Ícono de la aplicación
│   │   ├── login/
│   │   │   └── page.tsx                   # Pantalla de inicio de sesión para Administradores
│   │   ├── dashboard/
│   │   │   └── page.tsx                   # Panel Administrativo principal (Centro de Control)
│   │   └── api/
│   │       ├── logout/route.ts            # Endpoint para cerrar sesión administrativa y limpiar cookies
│   │       └── push/check/route.ts        # Endpoint para verificar y despachar alarmas Web Push pendientes
│   ├── actions/                           # Server Actions (Lógica de servidor llamada desde el frontend)
│   │   ├── attendance.ts                  # Validación de DNI, marcación, Kiosco, vinculación de celular y regularización
│   │   ├── auth.ts                        # Inicio/cierre de sesión y cambio obligatorio de contraseña
│   │   ├── users.ts                       # CRUD de usuarios, carga masiva Excel y asignación de administradores
│   │   ├── schedules.ts                   # Gestión del cronograma mensual, turnos dominicales e importación Excel
│   │   ├── daily-program.ts               # Consulta en vivo del Excel/API de programación diaria para el Admin
│   │   ├── tolerance.ts                   # Creación/edición de reglas de horarios y tolerancias de entrada/tardanza
│   │   ├── overtime.ts                    # Cálculo y configuración de horas extras de técnicos
│   │   ├── catalogs.ts                    # CRUD de Sedes (con coordenadas GPS y geocerca) y Cursos
│   │   ├── analytics.ts                   # Consulta de métricas de puntualidad, tardanzas y faltas por fecha/sede
│   │   ├── reports.ts                     # Consulta filtrada de asistencias para exportación a Excel/CSV
│   │   └── push.ts                        # Suscripción de celulares a Web Push y envío de notificación de prueba
│   ├── components/                        # Componentes visuales de React
│   │   ├── attendance-form.tsx            # Formulario principal de marcación (DNI, GPS, Kiosco, alarmas de rotación)
│   │   ├── live-clock.tsx                 # Reloj digital en tiempo real (hora oficial de Lima) en el portal
│   │   ├── dashboard-chart.tsx            # Gráfico de línea de flujo de asistencias de los últimos 7 días
│   │   ├── dashboard/                     # Módulos y pestañas del Panel Administrativo
│   │   │   ├── overview.tsx               # Pestaña "Resumen": marcaciones del día y regularización rápida de salidas
│   │   │   ├── daily-program.tsx          # Pestaña/Modal "Horarios del Día (Excel)" en vivo + regularización de salida
│   │   │   ├── analytics.tsx              # Pestaña "Métricas": KPIs, gráficos y consolidado de RRHH
│   │   │   ├── reports.tsx                # Pestaña "Exportación": filtros avanzados, descarga Excel y regularización
│   │   │   ├── rules.tsx                  # Pestaña "Horarios y Tolerancias": configuración de turnos y minutos de gracia
│   │   │   ├── schedules.tsx              # Pestaña "Cronograma Técnicos": calendario mensual, domingos y horas extras
│   │   │   ├── users.tsx                  # Pestaña "Personal Operativo": directorio, alta/baja y liberación de celular (📱)
│   │   │   ├── upload.tsx                 # Modal de importación masiva de usuarios desde archivo Excel
│   │   │   ├── catalogs.tsx               # Pestaña "Sedes & Cursos": gestión de campus, radios GPS y cursos
│   │   │   ├── admins.tsx                 # Pestaña "Control de Acceso": permisos, niveles de admin y códigos de Kiosco
│   │   │   ├── audit-logs.tsx             # Pestaña "Informe de Logs": historial de auditoría de acciones administrativas
│   │   │   ├── manuals.tsx                # Centro de descarga de los 5 manuales PDF según el rol del administrador
│   │   │   └── force-change-password-modal.tsx # Modal que exige cambiar la contraseña temporal en el primer ingreso
│   │   └── ui/                            # Componentes base de interfaz (Shadcn UI / Tailwind)
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── chart.tsx
│   │       ├── form.tsx
│   │       ├── input.tsx
│   │       ├── label.tsx
│   │       ├── select.tsx
│   │       ├── sonner.tsx
│   │       ├── table.tsx
│   │       └── tabs.tsx
│   └── lib/                               # Motores de negocio, utilidades y conexión a datos
│       ├── prisma.ts                      # Instancia Singleton de conexión a PostgreSQL con Prisma Client
│       ├── daily-program-api.ts           # Sincronización en vivo con el Excel (Google Apps Script), fusión de módulos y alarmas
│       ├── device-binding.ts              # Motor servidor de vinculación exclusiva 1 Celular <-> 1 DNI (Anti-suplantación)
│       ├── device-fingerprint-client.ts   # Generador cliente del token único de dispositivo y autolimpieza de caché
│       ├── push-notifications.ts          # Motor servidor W3C Web Push (llaves VAPID y planificador de alarmas por módulo)
│       ├── background-alerts.ts           # Cliente de registro del Service Worker (/sw.js) y permisos de notificación
│       ├── geofence.ts                    # Cálculo matemático Haversine de distancia GPS y validación de Modo Híbrido
│       ├── kiosk-codes.ts                 # Gestión de códigos de 1 uso y códigos maestros permanentes (262026) de Kiosco
│       ├── tolerance.ts                   # Motor de evaluación de puntualidad (A_TIEMPO, TARDANZA, FALTA)
│       ├── overtime.ts                    # Motor de cálculo de horas extras con umbral mínimo y redondeo configurable
│       ├── schedule-constants.ts          # Horarios base por turno y parser de celdas Excel de rotación (M(V), T(N), EV)
│       ├── admin-scope.ts                 # Jerarquía de 4 niveles de Admin (Super Admin, Global, Sede, Coord. Pacientes)
│       ├── audit-log.ts                   # Registro y lectura de logs de auditoría (con exención de admin.clinsim)
│       ├── session.ts                     # Lectura y validación de la cookie de sesión del administrador
│       ├── analytics.ts                   # Agregación estadística de registros de asistencia y cruce con turnos
│       ├── analytics-types.ts             # Tipos de datos compartidos para reportes y métricas
│       ├── timezone.ts                    # Utilidades de zona horaria oficial America/Lima (UTC-5)
│       └── utils.ts                       # Función auxiliar cn() para combinar clases de Tailwind CSS
├── .env                                   # Variable de entorno DATABASE_URL (Conexión a PostgreSQL en Neon)
├── next.config.ts                         # Configuración de Next.js
├── package.json                           # Dependencias, librerías y scripts del proyecto (dev, build, start, test)
└── tsconfig.json                          # Configuración del compilador TypeScript
```

---

## 📂 2. Explicación Detallada de Cada Carpeta y Archivo

### A. Base de Datos (`/prisma`)
- **`prisma/schema.prisma`**: Define el modelo de datos relacional en PostgreSQL:
  - **Enums:**
    - `Role`: `SUPER_ADMIN`, `ADMIN_SECUNDARIO`, `DOCENTE`, `TECNICO`, `PACIENTE_SIMULADO`.
    - `RecordType`: `ENTRADA`, `SALIDA`.
    - `RecordStatus`: `A_TIEMPO`, `TARDANZA`, `FALTA`, `EXCEPCION`.
    - `Shift`: `MANANA`, `INTERMEDIO`, `TARDE`, `NOCHE`, `DESCANSO`, `COMISION`.
  - **Tablas (`Models`):**
    - `User`: Datos de colaboradores y administradores (nombre, DNI único, rol operativo, rol administrativo, permisos, sede base y turno base).
    - `Campus`: Sedes de la universidad (`Campus Villa`, `Campus Norte`, `Campus Ate`, `Campus Aramburú`) con latitud, longitud, radio en metros y estado de geocerca (`geoEnforced`).
    - `Course`: Catálogo de cursos de simulación.
    - `AttendanceRecord`: Historial de marcaciones de entrada y salida con fecha/hora exacta, sede, curso, estado de puntualidad e indicador de sincronización offline.
    - `ToleranceRule`: Reglas de horario de ingreso, minutos de anticipación, minutos de gracia, límite de tardanza y días de la semana aplicables.
    - `TechnicianSchedule`: Programación diaria de turnos y rotaciones por sede para los técnicos.
    - `SystemSetting`: Almacén clave-valor para configuraciones globales (llaves `VAPID_KEYS_V1`, suscripciones `MOBILE_PUSH_SUBSCRIPTIONS_V1`, vínculos atómicos de celulares `DEVBIND_DNI:*` y `DEVBIND_TOK:*`, códigos de Kiosco `KIOSK_ONE_TIME_CODES` e historial de auditoría `SYSTEM_AUDIT_LOGS`).

---

### B. Archivos Públicos y PWA (`/public`)
- **`public/sw.js`**: **Service Worker** instalado en el navegador del celular. Permite recibir notificaciones W3C Web Push desde el servidor y ejecutar alarmas programadas de fin de módulo con sonido, vibración y cartel emergente (*heads-up notification*) incluso cuando el navegador está cerrado o la pantalla del teléfono está bloqueada.
- **`public/manuals/Guia_Instalacion_App_Celular_UCSUR.pdf`**: Guía visual paso a paso con capturas de pantalla reales para Android (Chrome) y iPhone (Safari) que enseña a los colaboradores a instalar la web como aplicativo en su celular.
- **`public/manuales/*.pdf`**: Los 5 manuales PDF específicos para cada perfil de usuario del sistema.
- **`public/templates/*.xlsx`**: Plantillas oficiales en formato Excel para importar docentes, pacientes simulados y técnicos de forma masiva.

---

### C. Rutas y Páginas de Next.js (`/src/app` y `/src/middleware.ts`)
- **`src/middleware.ts`**: Protege las rutas privadas. Verifica la cookie `admin_session` antes de permitir el acceso a `/dashboard` y redirige a `/login` si no hay sesión válida.
- **`src/app/layout.tsx`**: Plantilla raíz del sistema. Configura la tipografía, el soporte de instalación móvil (Apple Web App / Android PWA) y el proveedor de notificaciones visuales `Sonner`.
- **`src/app/manifest.ts`**: Manifiesto estándar de Progressive Web App (PWA) para que los teléfonos instalen el portal con su propio ícono y a pantalla completa (`standalone`).
- **`src/app/page.tsx`**: **Portal Público de Asistencia**. Obtiene las sedes con sus coordenadas GPS desde caché y muestra el reloj en vivo junto con el formulario de marcación.
- **`src/app/login/page.tsx`**: Pantalla de autenticación para administradores y coordinadores.
- **`src/app/dashboard/page.tsx`**: **Panel de Control Administrativo**. Carga las métricas, catálogos, usuarios y las marcaciones del día aplicando automáticamente el filtro de alcance según el tipo de administrador conectado.
- **`src/app/api/logout/route.ts`**: Cierra la sesión administrativa eliminando la cookie `admin_session`.
- **`src/app/api/push/check/route.ts`**: Ruta API que permite disparar la revisión y envío de notificaciones Web Push programadas.

---

### D. Acciones de Servidor (`/src/actions`)
Contienen la lógica de backend ejecutada directamente en el servidor (`"use server"`):
- **`src/actions/attendance.ts`**:
  - `preloadAttendanceDirectoryAction`: Precarga el directorio diario en memoria para responder en `0ms` al digitar un DNI.
  - `validateUserAction`: Valida el DNI ingresado, comprueba el vínculo exclusivo del celular (`deviceToken`), consulta el turno del técnico o el Excel de programación diaria en vivo (para docentes y pacientes) y determina si corresponde marcar `ENTRADA` o `SALIDA`.
  - `registerAttendanceAction`: Registra la asistencia en PostgreSQL verificando la geocerca GPS (en celulares) o el token de Estación Oficial (en PCs Kiosco), además del bloqueo anti-suplantación y las reglas de tolerancia.
  - `regularizeMissingExitAction`: Permite a un administrador registrar manualmente la hora de salida de un paciente o colaborador que olvidó marcar su salida.
  - `authorizeKioskWithOneTimeCodeAction` / `authorizeKioskDeviceAction`: Vincula una computadora de sede como **Estación Oficial** (sin requerir GPS y permitiendo múltiples DNIs).
  - `resolveDeviceBindingAction` / `adminResetUserDeviceBindingAction`: Consulta o libera el celular vinculado a un DNI.
  - `syncOfflineRecordsAction`: Sincroniza en lote las marcaciones guardadas en memoria local cuando vuelve el internet.
- **`src/actions/daily-program.ts`**: Obtiene en tiempo real todas las sesiones del día desde el Excel de Google Sheets y las cruza con las asistencias registradas en la base de datos para el visor administrativo.
- **`src/actions/users.ts`**: Alta individual y masiva (Excel) de personal operativo, edición de datos, baja de usuarios y administración de cuentas con acceso al Dashboard.
- **`src/actions/schedules.ts`**: CRUD del cronograma mensual de técnicos, asignación automatizada de guardias de domingo e importación del rol mensual desde Excel.
- **`src/actions/tolerance.ts`**: Creación, edición y activación/desactivación de reglas de horario anticipado y tolerancia de tardanzas.
- **`src/actions/overtime.ts`**: Cálculo de horas extras de técnicos y configuración del umbral mínimo (por defecto 60 min) y modo de redondeo.
- **`src/actions/catalogs.ts`**: Gestión de sedes (incluyendo coordenadas GPS y activación de geocerca) y cursos.
- **`src/actions/analytics.ts`**: Consultas agregadas para los gráficos y KPIs de la pestaña Métricas.
- **`src/actions/reports.ts`**: Consultas filtradas por fecha, sede y rol para la pestaña Exportación.
- **`src/actions/push.ts`**: Guarda las suscripciones Web Push de los teléfonos y ejecuta el envío de prueba con app cerrada (5 segundos).
- **`src/actions/auth.ts`**: Verifica usuario/contraseña en el login administrativo y procesa el cambio de clave inicial.

---

### E. Componentes Visuales (`/src/components`)
- **`src/components/attendance-form.tsx`**: Componente principal del Portal de Asistencia. Gestiona:
  - El campo de DNI con bloqueo automático (`🔒 Equipo vinculado a este DNI`) en teléfonos personales.
  - La pre-validación de ubicación GPS en segundo plano.
  - La tarjeta informativa con nombre, rol, hora en vivo, sede, ambiente/consultorio y curso asignado.
  - Los botones de actualización en vivo del Excel y prueba de notificación con app cerrada.
  - Las alarmas sonoras, vibración y notificaciones nativas cuando termina un módulo o toca rotar de salón.
  - El modal discreto (ícono de candado) para vincular una PC como **Estación Oficial**.
- **`src/components/live-clock.tsx`**: Reloj en tiempo real con fecha y hora oficial de Lima (`America/Lima`).
- **`src/components/dashboard-chart.tsx`**: Gráfico de tendencia de asistencias de los últimos 7 días.
- **Carpeta `/src/components/dashboard/` (Módulos del Panel Administrativo):**
  - **`overview.tsx`**: Pestaña **Resumen**. Muestra las marcaciones registradas en el día actual y permite regularizar salidas pendientes con un clic.
  - **`daily-program.tsx`**: Visor **Horarios del Día (Excel)**. Muestra la programación en vivo de pacientes simulados, su estado por bloque (`Completado`, `En Curso`, `Sin Marcar`), el listado general del Excel y el botón **"Regularizar Salida"**.
  - **`analytics.tsx`**: Pestaña **Métricas**. Muestra porcentajes de puntualidad, tardanzas, faltas, cobertura de salidas y tabla consolidada de RRHH.
  - **`reports.tsx`**: Pestaña **Exportación**. Permite filtrar asistencias por rango de fechas, sede y rol, regularizar salidas olvidadas y descargar reportes en Excel (`.xlsx`) o `.csv`.
  - **`rules.tsx`**: Pestaña **Horarios y Tolerancias**. Administración de reglas por turno y sede.
  - **`schedules.tsx`**: Pestaña **Cronograma Técnicos**. Calendario mensual interactivo, turnos de domingo, reporte de horas extras e importación de Excel.
  - **`users.tsx`**: Pestaña **Personal Operativo** (o *Directorio de Pacientes Simulados*). Permite buscar, crear, editar o eliminar personal, abrir los horarios del día y **desvincular/liberar el celular de un colaborador (`📱`)** si cambió de teléfono.
  - **`upload.tsx`**: Modal para subir plantillas Excel de personal.
  - **`catalogs.tsx`**: Pestaña **Sedes & Cursos**. Configuración de campus, radios GPS y cursos.
  - **`admins.tsx`**: Pestaña **Control de Acceso**. Configuración de niveles de administrador, permisos por módulo y generación de códigos de 1 uso para PCs Kiosco.
  - **`audit-logs.tsx`**: Pestaña **Informe de Logs**. Historial detallado de acciones administrativas con filtros por categoría.
  - **`manuals.tsx`**: Ventana de consulta y descarga de los 5 manuales PDF oficiales.
  - **`force-change-password-modal.tsx`**: Modal de seguridad para cambio obligatorio de contraseña temporal.
- **Carpeta `/src/components/ui/`**: Componentes reutilizables de diseño (`button.tsx`, `card.tsx`, `chart.tsx`, `form.tsx`, `input.tsx`, `label.tsx`, `select.tsx`, `sonner.tsx`, `table.tsx`, `tabs.tsx`).

---

### F. Librerías y Motores de Negocio (`/src/lib`)
- **`src/lib/prisma.ts`**: Conexión Singleton a PostgreSQL mediante Prisma Client para evitar agotar conexiones en desarrollo y producción.
- **`src/lib/daily-program-api.ts`**: Motor de lectura en vivo del Excel de programación diaria. Incluye:
  - Normalización e indexación `O(N)` de nombres para emparejar colaboradores sin confundir homónimos.
  - Fusión automática de bloques continuos para **Pacientes Simulados** (solo emite alarma cuando cambian de tema/ambiente o terminan su programación corrida) y evaluación módulo por módulo para **Docentes** (emite alarma al finalizar cada módulo con una sección de alumnos).
- **`src/lib/device-binding.ts`**: Motor de seguridad en servidor que administra los vínculos atómicos `DEVBIND_DNI:<dni>` y `DEVBIND_TOK:<deviceToken>`, garantizando que un celular solo pueda marcar con un único DNI y que un DNI no pueda compartirse en otro teléfono, sin colisiones entre iPhones o modelos Android iguales.
- **`src/lib/device-fingerprint-client.ts`**: Generador en cliente del `deviceToken` criptográfico único (persistido en `localStorage`, Cookies y `CacheStorage`) y limpiador automático de cachés antiguas (`purgeLegacyContaminatedDniCache`).
- **`src/lib/push-notifications.ts`**: Motor servidor W3C Web Push con generación automática de llaves VAPID y planificador que despacha notificaciones push a los celulares cuando se cumple la hora de fin de módulo.
- **`src/lib/background-alerts.ts`**: Funciones cliente para registrar `/sw.js`, pedir permisos de notificación al sistema operativo móvil y sincronizar alarmas con el Service Worker.
- **`src/lib/geofence.ts`**: Coordenadas oficiales de los 4 campus de la universidad y fórmula de Haversine para validar si el GPS del celular está dentro del perímetro permitido.
- **`src/lib/kiosk-codes.ts`**: Administración de los códigos maestros permanentes de Kiosco (`262026` y `262601`–`262604`, que no caducan ni dejan rastro en los logs) y de los códigos temporales de un solo uso.
- **`src/lib/tolerance.ts`**: Lógica pura para validar la ventana de entrada anticipada y clasificar cada ingreso como `A_TIEMPO`, `TARDANZA` o `FALTA`.
- **`src/lib/overtime.ts`**: Cálculo matemático de horas extras de técnicos al comparar la hora esperada de salida con la marcación real.
- **`src/lib/schedule-constants.ts`**: Horarios predeterminados por turno (`MANANA`, `INTERMEDIO`, `TARDE`, `NOCHE`, `COMISION`) y parser de códigos de celdas Excel (`M(V)`, `T(N)`, `D`, `EV`).
- **`src/lib/admin-scope.ts`**: Sistema de permisos y alcance jerárquico (`SUPER_ADMIN`, `ADMIN_GLOBAL`, `ADMIN_SEDE`, `COORDINADOR_PACIENTES`).
- **`src/lib/audit-log.ts`**: Motor de auditoría administrativa con exención automática para la cuenta maestra `admin.clinsim`.
- **`src/lib/session.ts`**: Decodificación y verificación de sesión administrativa desde cookies HTTP.
- **`src/lib/analytics.ts`** y **`src/lib/analytics-types.ts`**: Procesamiento estadístico de registros de asistencia para KPIs y tablas de RRHH.
- **`src/lib/timezone.ts`**: Funciones de fecha y hora fijadas en la zona horaria `America/Lima` (`UTC-5`).
- **`src/lib/utils.ts`**: Utilidad `cn()` para combinación condicional de estilos CSS.

---

### G. Scripts de Pruebas y Documentación (`/scripts`)
- **`scripts/test-all-features.ts`**: Suite integral con **108 pruebas automatizadas** (`npm test`) que validan todos los módulos del proyecto antes de cada despliegue.
- **`scripts/generate-manual.ts`**: Script que construye y exporta los 5 manuales PDF oficiales del sistema en `/public/manuales` y `/docs/manuales`.

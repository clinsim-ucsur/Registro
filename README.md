# ClinSim UCSUR - Sistema de Control de Asistencias y Gestión Operativa

Sistema integral de registro, control de asistencia en tiempo real, geolocalización perimétrica y gestión de cronogramas rotativos para los Centros de Simulación Clínica de la Universidad Científica del Sur (**UCSUR**).

---

## 🌟 Características Principales

### 1. Marcación de Asistencias Inteligente (Entrada y Salida)
- **Roles Soportados:** Técnicos de Simulación, Docentes, Pacientes Simulados y Administradores.
- **Geocercas Perimétricas por Sede:** Validación de coordenadas GPS para asegurar que las marcaciones se realicen únicamente dentro del perímetro autorizado de cada sede (Sede Villa, Aramburú, Ate y Los Olivos).
- **Control de Turnos y Franjas Horarias:**
  - Mañana: 06:00 - 15:00
  - Tarde: 13:00 - 22:00
  - Intermedio Lunes a Viernes: 09:00 - 18:00
  - Intermedio Sábados: 08:00 - 17:00
  - Intermedio Domingos: 10:00 - 19:00
  - Bloqueo de marcaciones anticipadas fuera de la ventana de tolerancia permitida.
- **Detección Automática de Estado:** Alternancia inteligente entre `ENTRADA` y `SALIDA` según el estado del día.
- **Soporte Offline PWA:** Registro en almacenamiento local ante caídas de red y sincronización automática cuando vuelve el internet.

### 2. Cronograma de Técnicos y Reconocimiento OCR
- **Gestión Visual de Cronogramas:** Calendario interactivo mensual con asignación por técnico, sede y turno.
- **Reconocimiento Óptico (OCR) de Rol Mensual:** Capacidad de subir la imagen de la plantilla oficial de turnos para extraer e importar automáticamente las rotaciones de técnicos entre sedes (Villa, Ate, Norte, Aramburú).
- **Edición Manual y Reasignación Rápida:** Asignación individual o masiva de turnos y sedes con control de excepciones.

### 3. Reglas de Tolerancia y Horarios Flexibles
- Configuración de minutos de tolerancia para marcaciones a tiempo (`A TIEMPO`), tardanzas (`TARDANZA`) y faltas automáticas.
- Creación y edición de reglas específicas para cada turno y rol.

### 4. Gestión de Usuarios y Doble Rol (Operativo + Admin)
- Registro y actualización de Docentes, Pacientes Simulados y Técnicos.
- **Promoción a Administrador:** Personal operativo (por ejemplo un técnico o paciente simulado) puede ser promovido a Administrador con acceso al dashboard sin perder su historial de marcaciones ni su capacidad de registrar asistencia.
- **Importación Masiva Excel / CSV:** Detección de duplicados, asignación masiva de sede y previsualización de datos antes de confirmar.

### 5. Seguridad y Primer Acceso
- **Contraseña Temporal / Primer Inicio:** Obligatoriedad de cambio de contraseña en el primer inicio de sesión mediante ventana modal bloqueante.
- **Auditoría y Roles Administrativos:** Roles `SUPER_ADMIN` y `ADMIN_SECUNDARIO` con control granular de módulos permitidos (Overview, Analítica, Reportes, Reglas, Usuarios, Catálogos, Admins).

### 6. Reportes y Analítica
- Visualización de métricas en tiempo real, gráficos de puntualidad y distribución de asistencia por sede.
- Exportación directa de reportes consolidados en formatos **Excel (.xlsx)** y **PDF**.

---

## 🛠️ Stack Tecnológico

- **Framework:** [Next.js 16 (App Router)](https://nextjs.org/) con React 19 y Turbopack.
- **Lenguaje:** TypeScript.
- **Estilos:** Tailwind CSS y diseño adaptable para dispositivos móviles, quioscos y computadoras de escritorio.
- **Base de Datos & ORM:** PostgreSQL (Neon Serverless) con [Prisma ORM](https://www.prisma.io/).
- **OCR:** [Tesseract.js](https://tesseract.projectnaptha.com/) para reconocimiento de cronogramas.
- **Generación de Reportes:** jsPDF, jsPDF-AutoTable y SheetJS (xlsx).

---

## 🚀 Puesta en Marcha Local

### Prerrequisitos
- Node.js 20+ instalado
- Gestor de paquetes `npm`

### Pasos
1. Clonar el repositorio:
   ```bash
   git clone https://github.com/clinsim-ucsur/Registro.git
   cd Registro
   ```

2. Instalar dependencias:
   ```bash
   npm install
   ```

3. Configurar variables de entorno en `.env`:
   ```env
   DATABASE_URL="postgresql://usuario:contraseña@servidor/bd?sslmode=require"
   ```

4. Generar el cliente de Prisma:
   ```bash
   npx prisma generate
   ```

5. Iniciar el servidor de desarrollo:
   ```bash
   npm run dev
   ```

6. Abrir [http://localhost:3000](http://localhost:3000) en el navegador.

---

## 📖 Manual de Usuario

El manual de usuario detallado en formato PDF con la guía paso a paso para operadores, técnicos y administradores se encuentra disponible para descarga en:
- `docs/MANUAL_DE_USUARIO_CLINSIM.pdf`

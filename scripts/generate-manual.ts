import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import fs from 'fs';
import path from 'path';

const doc = new jsPDF({
  orientation: 'portrait',
  unit: 'mm',
  format: 'a4'
});

// Colores institucionales UCSUR / ClinSim
const PRIMARY = [11, 27, 61];     // #0B1B3D
const ACCENT = [25, 103, 210];    // #1967D2
const TEXT_DARK = [30, 41, 59];   // #1E293B

// Portada / Encabezado
doc.setFillColor(PRIMARY[0], PRIMARY[1], PRIMARY[2]);
doc.rect(0, 0, 210, 48, 'F');

doc.setTextColor(255, 255, 255);
doc.setFont('helvetica', 'bold');
doc.setFontSize(22);
doc.text('ClinSim UCSUR', 20, 20);

doc.setFont('helvetica', 'normal');
doc.setFontSize(11);
doc.setTextColor(200, 220, 255);
doc.text('Centro de Simulacion Clinica - Universidad Cientifica del Sur', 20, 28);
doc.text('Manual Oficial de Usuario y Guia de Operaciones', 20, 36);

let y = 60;

function addSectionTitle(title: string) {
  if (y > 245) {
    doc.addPage();
    y = 25;
  }
  doc.setFillColor(235, 242, 254);
  doc.roundedRect(18, y - 5, 174, 10, 2, 2, 'F');
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(title, 22, y + 2);
  y += 14;
}

function addParagraph(text: string) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
  const splitText = doc.splitTextToSize(text, 170);
  for (const line of splitText) {
    if (y > 275) {
      doc.addPage();
      y = 25;
    }
    doc.text(line, 20, y);
    y += 5.5;
  }
  y += 2;
}

function addBullet(bulletText: string) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(TEXT_DARK[0], TEXT_DARK[1], TEXT_DARK[2]);
  const splitText = doc.splitTextToSize('- ' + bulletText, 166);
  for (let i = 0; i < splitText.length; i++) {
    if (y > 275) {
      doc.addPage();
      y = 25;
    }
    doc.text(splitText[i], i === 0 ? 20 : 24, y);
    y += 5;
  }
}

// 1. INTRODUCCION
addSectionTitle('1. Introduccion y Proposito del Sistema');
addParagraph('El sistema ClinSim UCSUR ha sido concebido para modernizar, automatizar y brindar maxima precision en el registro de asistencia del personal y participantes del Centro de Simulacion Clinica (Tecnicos de Simulacion, Pacientes Simulados y Docentes), a traves de geocercas perimetricas GPS, control de turnos en tiempo real, reconocimiento de cronogramas y reportabilidad ejecutiva.');

// 2. MODULO DE ASISTENCIA
addSectionTitle('2. Registro de Asistencias (Pantalla Principal)');
addParagraph('La interfaz publica permite a los usuarios registrar su entrada y salida de forma agil desde dispositivos moviles o quioscos:');
addBullet('Seleccion de Rol: El usuario selecciona su rol correspondiente (Tecnico, Docente o Paciente Simulado).');
addBullet('Ingreso de DNI: Se valida la existencia del usuario y la concordancia con el rol elegido.');
addBullet('Geolocalizacion perimetrica: El sistema valida la ubicacion GPS para corroborar que el usuario se encuentre dentro del radio perimetrico autorizado de la sede (Villa, Aramburu, Ate o Los Olivos).');
addBullet('Control de Franja Horaria de Turno: Los tecnicos deben marcar dentro de su ventana de turno permitida (con tolerancia de 15 minutos de anticipacion al inicio del turno). No se permite registrar ingreso con horas de antelacion no programadas.');
addBullet('Alternancia inteligente: Si el usuario ya marco Entrada en el dia, el sistema le ofrecera automaticamente marcar Salida.');

// 3. HORARIOS Y TURNOS
addSectionTitle('3. Horarios y Turnos Oficiales de Tecnicos');
addParagraph('El sistema cuenta con las siguientes franjas horarias configuradas con verificacion automatica de tolerancia:');

autoTable(doc, {
  startY: y + 2,
  margin: { left: 20, right: 20 },
  head: [['Turno', 'Dias Aplicables', 'Horario de Entrada y Salida', 'Ventana Permitida Entrada']],
  body: [
    ['Manana (M)', 'Lunes a Domingo', '06:00 - 15:00', 'Desde 05:45'],
    ['Tarde (T)', 'Lunes a Domingo', '13:00 - 22:00', 'Desde 12:45'],
    ['Intermedio L-V (I)', 'Lunes a Viernes', '09:00 - 18:00', 'Desde 08:45'],
    ['Intermedio Sabado (I)', 'Sabados', '08:00 - 17:00', 'Desde 07:45'],
    ['Intermedio Domingo (I)', 'Domingos', '10:00 - 19:00', 'Desde 09:45'],
  ],
  headStyles: { fillColor: [11, 27, 61], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5 },
  bodyStyles: { fontSize: 8, textColor: [30, 41, 59] },
  alternateRowStyles: { fillColor: [245, 248, 255] },
});

// @ts-ignore
y = (doc as any).lastAutoTable.finalY + 10;

// 4. CRONOGRAMAS Y OCR
addSectionTitle('4. Cronograma Mensual y Reconocimiento OCR de Plantilla');
addParagraph('En la pestana Cronograma Tecnicos, los administradores pueden gestionar las rotaciones de sede y asignaciones de turno:');
addBullet('Reconocimiento por Imagen (OCR): Se puede cargar la imagen de la planilla mensual de turnos. El motor identifica automaticamente el personal por sede de procedencia (7 tecnicos en Villa, 2 en Norte, 2 en Ate) y asigna sus turnos (M, T, I) asi como sus rotaciones a otras sedes indicadas entre parentesis ej. (N), (A), (V).');
addBullet('Asignacion y Edicion Manual: Facilidad de seleccionar un tecnico y modificar en que sede y turno le corresponde estar cualquier dia del mes.');

// 5. GESTION DE USUARIOS Y DOBLE ROL
addSectionTitle('5. Gestion de Usuarios y Doble Rol (Operativo + Admin)');
addParagraph('El sistema soporta personal multidisciplinario que requiere operar asistencias y gestionar el sistema simultaneamente:');
addBullet('Personal Operativo: Registro manual o importacion masiva por Excel de pacientes simulados, docentes y tecnicos con deteccion de duplicados.');
addBullet('Promocion a Administrador: Cualquier usuario registrado en la base de datos (incluso un tecnico o paciente) puede ser promovido a Administrador. Esto le otorga acceso al Dashboard administrativo con usuario y contrasena sin perder su historial de marcaciones.');
addBullet('Primer Inicio y Cambio Obligatorio de Contrasena: Al acceder por primera vez con una contrasena asignada o temporal, el sistema desplegara automaticamente un modal a pantalla completa obligando a configurar una nueva contrasena privada antes de interactuar con el panel.');

// 6. REPORTES Y EXPORTACION
addSectionTitle('6. Reportes y Analitica');
addParagraph('En las secciones de Reportes y Analitica es posible:');
addBullet('Filtrar asistencias por fecha, sede, rol y estado de puntualidad (A Tiempo, Tardanza, Falta).');
addBullet('Descargar la informacion en planillas Excel (.xlsx) consolidadas para el departamento de Recursos Humanos.');
addBullet('Exportar informes formales en PDF con resumen ejecutivo de asistencia.');

// Pie de pagina con numeracion
const pageCount = (doc.internal as any).getNumberOfPages();
for (let i = 1; i <= pageCount; i++) {
  doc.setPage(i);
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Centro de Simulacion Clinica UCSUR - Sistema de Control de Asistencias | Pagina ' + i + ' de ' + pageCount, 20, 288);
}

const docsDir = path.join(process.cwd(), 'docs');
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const pdfPath = path.join(docsDir, 'MANUAL_DE_USUARIO_CLINSIM.pdf');
const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
fs.writeFileSync(pdfPath, pdfBuffer);
console.log('PDF creado exitosamente en:', pdfPath);

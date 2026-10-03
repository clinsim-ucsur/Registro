"use client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileText, FileSpreadsheet, DownloadCloud } from "lucide-react"
import * as XLSX from "xlsx"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { toast } from "sonner"

export function DashboardReports({ records }: { records: any[] }) {
  
  // Función para preparar los datos limpios para ambos formatos
  const getFormattedData = () => {
    return records.map(record => {
      const dateObj = new Date(record.timestamp)
      const dateStr = dateObj.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' })
      const timeStr = dateObj.toLocaleTimeString('es-PE', { hour12: true, hour: '2-digit', minute: '2-digit' })
      
      return {
        "Fecha": dateStr,
        "Hora": timeStr,
        "DNI": record.user?.dni || "-",
        "Nombre Completo": record.user?.name || "Desconocido",
        "Rol": record.role || "-",
        "Tipo": record.type === 'ENTRADA' ? 'Ingreso' : 'Salida'
      }
    })
  }

  const handleExportExcel = () => {
    if (!records || records.length === 0) {
      toast.error("No hay registros en el sistema para exportar.")
      return
    }

    try {
      const data = getFormattedData()
      const worksheet = XLSX.utils.json_to_sheet(data)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, worksheet, "Control Asistencia")
      
      // Auto-ajustar ancho de columnas para que se vea estético
      worksheet['!cols'] = [
        { wch: 12 }, // Fecha
        { wch: 12 }, // Hora
        { wch: 12 }, // DNI
        { wch: 45 }, // Nombre
        { wch: 22 }, // Rol
        { wch: 15 }, // Tipo
      ]

      const fileName = `Reporte_Registro_Asistencia_${new Date().toISOString().split('T')[0]}.xlsx`
      XLSX.writeFile(workbook, fileName)
      toast.success("Excel generado y descargado con éxito.")
    } catch (e) {
      toast.error("Hubo un error al generar el archivo Excel.")
    }
  }

  const handleExportPDF = () => {
    if (!records || records.length === 0) {
      toast.error("No hay registros en el sistema para exportar.")
      return
    }
    
    try {
      // jsPDF landscape (horizontal) para que los nombres largos quepan bien
      const doc = new jsPDF('landscape')
      const data = getFormattedData()
      
      // Diseño Corporativo del PDF (Colores de la marca)
      doc.setFontSize(22)
      doc.setTextColor(25, 103, 210) // Azul corporativo (#1967D2)
      doc.text("Reporte General de Accesos y Asistencias", 14, 22)
      
      doc.setFontSize(10)
      doc.setTextColor(100, 100, 100)
      doc.text(`Documento generado el: ${new Date().toLocaleString('es-PE')}`, 14, 30)
      doc.text(`Total de registros incluidos: ${records.length}`, 14, 36)

      // Convertir el JSON a matriz 2D para autoTable
      const tableRows = data.map(row => [
        row.Fecha,
        row.Hora,
        row.DNI,
        row["Nombre Completo"],
        row.Rol,
        row.Tipo
      ])

      autoTable(doc, {
        startY: 42,
        head: [['Fecha', 'Hora', 'DNI', 'Nombre Completo', 'Rol', 'Tipo']],
        body: tableRows,
        theme: 'grid',
        headStyles: { fillColor: [25, 103, 210], fontSize: 11, textColor: 255 },
        styles: { fontSize: 10, cellPadding: 4, textColor: 50 },
        alternateRowStyles: { fillColor: [245, 248, 252] }, // Gris-azulado muy claro
      })

      const fileName = `Reporte_Registro_Asistencia_${new Date().toISOString().split('T')[0]}.pdf`
      doc.save(fileName)
      toast.success("PDF generado y descargado con éxito.")
    } catch (e) {
      toast.error("Hubo un error al generar el archivo PDF.")
    }
  }

  return (
    <div className="animate-fade-in-up">
      <Card className="border-slate-200/60 shadow-sm rounded-2xl bg-white max-w-4xl mx-auto mt-6">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-20 h-20 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-6">
            <DownloadCloud size={40} />
          </div>
          <CardTitle className="text-3xl font-extrabold text-slate-800">Exportación de Datos</CardTitle>
          <CardDescription className="text-lg max-w-2xl mx-auto mt-2 text-slate-500">
            Genera y descarga en un clic reportes oficiales de asistencia con toda la base de datos lista para presentar o auditar.
          </CardDescription>
        </CardHeader>
        <CardContent className="mt-8 flex flex-col sm:flex-row gap-6 justify-center pb-12">
          <Button onClick={handleExportExcel} className="bg-emerald-600 hover:bg-emerald-700 h-16 px-10 rounded-2xl font-bold text-xl shadow-lg shadow-emerald-600/20 transition-transform hover:scale-105">
            <FileSpreadsheet className="mr-3" size={28} /> Exportar XLSX (.excel)
          </Button>
          <Button onClick={handleExportPDF} className="bg-rose-600 hover:bg-rose-700 h-16 px-10 rounded-2xl font-bold text-xl shadow-lg shadow-rose-600/20 transition-transform hover:scale-105">
            <FileText className="mr-3" size={28} /> Generar PDF Oficial
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

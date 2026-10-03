"use client"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { UploadCloud, CheckCircle2, FileSpreadsheet, Loader2, AlertCircle } from "lucide-react"
import * as XLSX from "xlsx"
import { bulkUploadUsersAction } from "@/actions/users"
import { toast } from "sonner"

export function DashboardUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [previewData, setPreviewData] = useState<any[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isUploading, setIsUploading] = useState(false)

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (!selected) return

    setFile(selected)
    setIsProcessing(true)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result
        const wb = XLSX.read(bstr, { type: 'binary' })
        const wsname = wb.SheetNames[0]
        const ws = wb.Sheets[wsname]
        
        // Convertimos a JSON. Se espera que las cabeceras sean exactamente DNI, Nombre, Rol, Campus
        const rawData = XLSX.utils.sheet_to_json(ws, { defval: "" })
        
        // Mapeamos a nuestras keys internas de forma segura ignorando mayúsculas/minúsculas
        const mappedData = rawData.map((row: any) => {
          const keys = Object.keys(row)
          const getVal = (possibleKeys: string[]) => {
            const key = keys.find(k => possibleKeys.includes(k.toLowerCase().trim()))
            return key ? row[key] : ""
          }
          return {
            dni: getVal(['dni', 'documento', 'id']),
            name: getVal(['nombre', 'nombres', 'name', 'nombre completo']),
            role: getVal(['rol', 'cargo', 'role']),
            campus: getVal(['campus', 'sede', 'local'])
          }
        }).filter(item => item.dni || item.name)

        setPreviewData(mappedData)
      } catch (error) {
        toast.error("Error al leer el archivo. Asegúrate de que es un Excel o CSV válido.")
        setFile(null)
      } finally {
        setIsProcessing(false)
      }
    }
    reader.readAsBinaryString(selected)
  }

  const handleSaveToDB = async () => {
    if (previewData.length === 0) return
    setIsUploading(true)
    
    try {
      const res = await bulkUploadUsersAction(previewData)
      if (res.success) {
        toast.success(res.message, { duration: 6000 })
        setFile(null)
        setPreviewData([])
      } else {
        toast.error(res.message)
      }
    } catch (error) {
      toast.error("Ocurrió un error inesperado al subir la información.")
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <div className="animate-fade-in-up space-y-6">
      <Card className="border-slate-200/60 shadow-sm rounded-2xl bg-white max-w-4xl mx-auto">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4">
            <UploadCloud size={32} />
          </div>
          <CardTitle className="text-2xl font-extrabold text-slate-800">Carga Masiva de Usuarios</CardTitle>
          <CardDescription className="text-base max-w-2xl mx-auto">
            Sube un archivo CSV o Excel (.xlsx) con la lista oficial. <br/>
            Las columnas requeridas son: <strong>DNI, Nombre</strong>. <br/>
            Columnas opcionales: <strong>Rol, Campus</strong>.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="mt-4">
          {!file ? (
            <div className="border-2 border-dashed border-slate-300 rounded-2xl p-10 text-center hover:bg-slate-50/50 hover:border-[#1967D2]/50 transition-all cursor-pointer flex flex-col items-center group relative overflow-hidden">
              <FileSpreadsheet className="text-slate-400 mb-4 group-hover:text-[#1967D2] transition-colors" size={48} />
              <p className="text-slate-700 font-bold text-lg">Haz clic aquí para seleccionar tu archivo</p>
              <p className="text-slate-500 text-sm mt-1 mb-6">Soporta formatos .xlsx y .csv</p>
              
              <div className="relative">
                <Button className="bg-[#1967D2] hover:bg-blue-800 rounded-xl px-8" type="button">Examinar equipo</Button>
                <input 
                  type="file" 
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                  accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                  onChange={handleFileUpload}
                />
              </div>
            </div>
          ) : (
            <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-emerald-100 rounded-full">
                  <CheckCircle2 className="text-emerald-600" size={24} />
                </div>
                <div>
                  <p className="font-extrabold text-slate-800 text-lg">{file.name}</p>
                  <p className="text-sm font-medium text-slate-500">
                    {(file.size / 1024).toFixed(2)} KB • {previewData.length} registros detectados
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => {setFile(null); setPreviewData([])}} disabled={isUploading} className="rounded-xl border-slate-300 text-slate-600">
                  Cancelar
                </Button>
                <Button onClick={handleSaveToDB} disabled={isUploading} className="bg-emerald-600 hover:bg-emerald-700 rounded-xl px-6 shadow-md shadow-emerald-500/20">
                  {isUploading ? <Loader2 className="animate-spin mr-2" size={18} /> : <UploadCloud className="mr-2" size={18} />}
                  {isUploading ? "Guardando en BD..." : "Confirmar e Importar"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Previsualización */}
      {previewData.length > 0 && (
        <Card className="border-slate-200/60 shadow-sm rounded-2xl bg-white max-w-4xl mx-auto overflow-hidden animate-fade-in-up">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-4 px-6 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg font-bold text-slate-800">Vista Previa de Datos</CardTitle>
              <CardDescription className="text-xs">Revisa que las columnas coincidan antes de importar.</CardDescription>
            </div>
            {previewData.some(d => d.dni?.toString().length !== 8) && (
              <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg text-xs font-bold">
                <AlertCircle size={14} /> Algunos DNI no tienen 8 dígitos y serán omitidos.
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader className="bg-slate-50/80 sticky top-0 z-10 backdrop-blur-sm">
                  <TableRow>
                    <TableHead className="font-bold text-slate-500 px-6">DNI</TableHead>
                    <TableHead className="font-bold text-slate-500">Nombre Completo</TableHead>
                    <TableHead className="font-bold text-slate-500">Rol Detectado</TableHead>
                    <TableHead className="font-bold text-slate-500 px-6">Sede</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewData.slice(0, 100).map((row, i) => (
                    <TableRow key={i} className="hover:bg-slate-50/50">
                      <TableCell className="px-6 font-bold text-slate-700">
                        {row.dni} 
                        {row.dni?.toString().length !== 8 && <span className="text-rose-500 ml-2" title="Inválido">⚠️</span>}
                      </TableCell>
                      <TableCell className="font-medium text-slate-700">{row.name}</TableCell>
                      <TableCell>
                        <span className="px-2 py-1 bg-slate-100 rounded-md text-xs font-bold text-slate-600">{row.role || 'DOCENTE (Default)'}</span>
                      </TableCell>
                      <TableCell className="px-6 text-slate-500 font-medium">{row.campus || '-'}</TableCell>
                    </TableRow>
                  ))}
                  {previewData.length > 100 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-4 text-slate-400 text-sm font-bold bg-slate-50">
                        Mostrando los primeros 100 registros de {previewData.length}...
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

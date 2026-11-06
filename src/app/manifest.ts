import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Portal de Asistencia - Clínica de Simulación UCSUR",
    short_name: "Asistencia UCSUR",
    description: "Sistema de registro de asistencia para Docentes, Técnicos y Pacientes Simulados - Universidad Científica del Sur",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#1967D2",
    theme_color: "#1967D2",
    icons: [
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  }
}


"use client"
import { Line, LineChart, CartesianGrid, XAxis, Tooltip, ResponsiveContainer, YAxis } from "recharts"
import { ChartConfig, ChartContainer, ChartTooltipContent } from "@/components/ui/chart"

export function DashboardChart({ data }: { data: any[] }) {
  const chartConfig = {
    total: {
      label: "Asistencias",
      color: "#1967D2",
    },
  } satisfies ChartConfig

  return (
    <ChartContainer config={chartConfig} className="h-[220px] w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 15, right: 20, left: -10, bottom: 0 }}>
          
          {/* Cuadrícula completa: líneas horizontales y verticales para demarcar cada día */}
          <CartesianGrid vertical={true} horizontal={true} strokeDasharray="4 4" opacity={0.5} stroke="#cbd5e1" />
          
          {/* Eje X (Días) */}
          <XAxis
            dataKey="date"
            tickLine={true}
            tickMargin={12}
            axisLine={true}
            tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
            stroke="#cbd5e1"
          />
          
          {/* Eje Y (Numeración / Cantidades) visible */}
          <YAxis 
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
            tickMargin={10}
            width={40}
          />
          
          <Tooltip content={<ChartTooltipContent />} />
          
          <Line 
            type="monotone" 
            dataKey="total" 
            stroke="var(--color-total)" 
            strokeWidth={4}
            dot={{ fill: "var(--color-total)", strokeWidth: 0, r: 4 }}
            activeDot={{ r: 7, fill: "#ffffff", stroke: "var(--color-total)", strokeWidth: 3 }}
            animationDuration={1500}
          />
        </LineChart>
      </ResponsiveContainer>
    </ChartContainer>
  )
}

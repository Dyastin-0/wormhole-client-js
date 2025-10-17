import React, { useState, useEffect, useRef } from 'react'
import { render, Box, Text, useApp, useInput } from 'ink'
import { Client } from './client.js'

interface Metrics {
  ingress: bigint
  egress: bigint
  uptime: bigint
  connectionCount: bigint
  activeConnections: number
}

interface MetricsProps {
  signal: AbortSignal
  client: Client
}

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let i = -1
  do {
    bytes /= 1024
    i++
  } while (bytes >= 1024 && i < units.length - 1)
  return `${bytes.toFixed(1)} ${units[i]}`
}

const formatDuration = (ns: bigint): string => {
  const totalSeconds = Number(ns / 1_000_000_000n)
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60

  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

const pad = (str: string, width: number) => str.padEnd(width, ' ')

const MetricsDisplay: React.FC<MetricsProps> = ({ signal, client }) => {
  const { exit } = useApp()

  const [metrics, setMetrics] = useState<Metrics>({
    ingress: 0n,
    egress: 0n,
    uptime: 0n,
    connectionCount: 0n,
    activeConnections: 0,
  })

  useEffect(() => {
    if (!signal) return

    const handler = () => {
      exit()
    }

    signal.addEventListener('abort', handler)

    return () => {
      signal.removeEventListener('abort', handler)
    }
  }, [signal, exit])

  const [rates, setRates] = useState({ ingressRate: 0, egressRate: 0 })
  const prevMetrics = useRef(metrics)
  const prevTime = useRef(performance.now())

  useEffect(() => {
    const updateRates = (newMetrics: Metrics) => {
      const now = performance.now()
      const dt = (now - prevTime.current) / 1000
      if (dt > 0) {
        const ingressDiff = Number(newMetrics.ingress - prevMetrics.current.ingress)
        const egressDiff = Number(newMetrics.egress - prevMetrics.current.egress)
        setRates({
          ingressRate: ingressDiff / dt,
          egressRate: egressDiff / dt,
        })
      }
      prevMetrics.current = newMetrics
      prevTime.current = now
    }

    const handler = (data: Metrics) => {
      setMetrics(data)
      updateRates(data)
    }

    client.on('metrics', handler)
    return () => {
      client.off('metrics', handler)
    }
  }, [client])


  useInput((input, key) => {
    if (input === 'q' || key.ctrl && input === 'c') {
      exit()
    }
  })


  const Line = ({ label, value, rate }: { label: string; value: string; rate?: string }) => (
    <Text>
      <Text color="gray">{pad(label, 10)}</Text>
      <Text bold color="cyan">{pad(value, 12)}</Text>
      {rate && <Text color="magenta">({rate}/s)</Text>}
    </Text>
  )

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      paddingX={4}
      paddingY={1}
      width={45}
    >
      <Box justifyContent="center">
        <Text bold underline color="cyan">
          {client.getDomain()}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">Traffic</Text>
        <Line
          label="Ingress:"
          value={formatBytes(Number(metrics.ingress))}
          rate={formatBytes(rates.ingressRate)}
        />
        <Line
          label="Egress:"
          value={formatBytes(Number(metrics.egress))}
          rate={formatBytes(rates.egressRate)}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color="gray">Connections</Text>
        <Line
          label="Active:"
          value={metrics.activeConnections.toString()}
        />
        <Line
          label="Total:"
          value={metrics.connectionCount.toString()}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Line
          label="Uptime:"
          value={formatDuration(metrics.uptime)}
        />
      </Box>

      <Box justifyContent='center' marginTop={1}>
        <Text color="gray">Press q or ctrl+c to quit</Text>
      </Box>
    </Box>
  )
}

export function renderMetrics(signal: AbortSignal, client: Client) {
  render(<MetricsDisplay signal={signal} client={client} />)
}

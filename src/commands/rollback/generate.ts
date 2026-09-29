import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {readFileSync, writeFileSync} from 'node:fs'
import {resolve} from 'node:path'

function runAgentia(args: string[], timeoutMs = 60_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

function rowsOf(parsed: any): any[] {
  if (!parsed || typeof parsed !== 'object') return []
  const r = parsed?.result ?? parsed
  if (Array.isArray(r)) return r
  if (Array.isArray(r?.data)) return r.data
  return []
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

interface UndoMember {
  type: string
  name: string
}

function membersOf(step: any): {mapped: UndoMember[]; unmapped: string[]} {
  const mapped: UndoMember[] = []
  const unmapped: string[] = []
  const candidates: any[] = Array.isArray(step?.members)
    ? step.members
    : Array.isArray(step?.metadata)
      ? step.metadata
      : Array.isArray(step?.files)
        ? step.files
        : []
  for (const m of candidates) {
    if (typeof m === 'string' && m.includes('.')) {
      const [type, ...rest] = m.split('.')
      mapped.push({type, name: rest.join('.')})
      continue
    }
    if (typeof m === 'object' && m !== null) {
      const type = str(m.metadataType || m.type || m.Type)
      const name = str(m.metadataName || m.member || m.name || m.apiName || m.Name)
      if (type !== '' && name !== '') {
        mapped.push({type, name})
        continue
      }
    }
    unmapped.push(typeof m === 'string' ? m : JSON.stringify(m).slice(0, 120))
  }
  const soloType = str(step?.metadataType || step?.type)
  const soloName = str(step?.metadataName || step?.member || step?.name || step?.apiName)
  if (mapped.length === 0 && unmapped.length === 0 && soloType !== '' && soloName !== '') {
    mapped.push({type: soloType, name: soloName})
  } else if (mapped.length === 0 && unmapped.length === 0) {
    const label = str(step?.name || step?.id || step?.stepType || 'step')
    if (label !== '') unmapped.push(label)
  }
  return {mapped, unmapped}
}

export default class RollbackGenerate extends Command {
  static description =
    'Generate a destructive changes preview file for metadata undo planning. Nothing is deployed or deleted.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --story US-0000024',
    '<%= config.bin %> <%= command.id %> --story US-0000024 --out ./rollback.xml --json',
    '<%= config.bin %> <%= command.id %> --steps-file steps.json --out ./rollback.xml',
  ]

  static flags = {
    story: Flags.string({char: 's', description: 'User story ID owning the deployment steps.'}),
    'steps-file': Flags.string({description: 'JSON array of deployment steps for offline use.'}),
    out: Flags.string({char: 'o', description: 'Output path for the destructive changes file.', default: './rollback.xml'}),
    'api-version': Flags.string({description: 'API version stamped in the file.', default: '61.0'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON summary.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(RollbackGenerate)
    const story = (flags.story as string | undefined) ?? null
    const stepsFile = (flags['steps-file'] as string | undefined) ?? null
    const outPath = resolve(process.cwd(), (flags.out as string) ?? './rollback.xml')
    const apiVersion = (flags['api-version'] as string) ?? '61.0'
    const asJson = (flags.json as boolean) ?? false

    if (!story && !stepsFile) {
      const detail = 'Pass --story for live steps or --steps-file for offline use.'
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    let steps: any[] = []
    if (stepsFile) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(resolve(process.cwd(), stepsFile), 'utf8'))
        steps = Array.isArray(parsed) ? parsed : rowsOf(parsed)
      } catch (error: any) {
        const detail = `Could not read steps file: ${(error?.message ?? String(error)).split('\n')[0]}`
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
    } else {
      try {
        const out = runAgentia(['cicd', 'work', 'deployment-step', 'list', '--user-story', story as string, '--json'])
        steps = rowsOf(JSON.parse(out))
      } catch (error: any) {
        const detail = `Step listing failed: ${(error?.message ?? String(error)).split('\n')[0]}`
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
    }

    const byType = new Map<string, Set<string>>()
    const unmapped: string[] = []
    for (const step of steps) {
      const {mapped, unmapped: miss} = membersOf(step)
      for (const m of mapped) {
        if (!byType.has(m.type)) byType.set(m.type, new Set())
        byType.get(m.type)?.add(m.name)
      }
      unmapped.push(...miss)
    }

    const lines: string[] = []
    lines.push('<?xml version="1.0" encoding="UTF-8"?>')
    lines.push('<Package xmlns="http://soap.sforce.com/2006/04/metadata">')
    for (const [type, names] of [...byType.entries()].sort()) {
      lines.push('    <types>')
      for (const name of [...names].sort()) lines.push(`        <members>${escXml(name)}</members>`)
      lines.push(`        <name>${escXml(type)}</name>`)
      lines.push('    </types>')
    }
    lines.push(`    <version>${escXml(apiVersion)}</version>`)
    lines.push('</Package>')
    writeFileSync(outPath, lines.join('\n') + '\n', 'utf8')

    const memberCount = [...byType.values()].reduce((n, s) => n + s.size, 0)
    const payload = {
      status: 'preview',
      story,
      stepCount: steps.length,
      mappedTypes: byType.size,
      memberCount,
      unmapped,
      file: outPath,
      note: 'Preview only. Nothing was deployed or deleted. Review every member before any real rollback.',
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      this.log(`Rollback preview for story ${story ?? 'offline'}: ${steps.length} steps, ${memberCount} members across ${byType.size} types into ${outPath}.`)
      if (unmapped.length > 0) this.log(`Unmapped entries needing manual review: ${unmapped.slice(0, 10).join('; ')}`)
      this.log('Preview only. Nothing was deployed or deleted.')
    }
  }
}

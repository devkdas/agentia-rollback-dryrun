import {Command, Flags} from '@oclif/core'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
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

export default class RollbackSimulate extends Command {
  static description =
    'Simulate a rollback against the target org index before generating the plan. Scores confidence honestly.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --story US-0000024 --source-credential-id a11 --source-org-id 00D',
    '<%= config.bin %> <%= command.id %> --steps-file steps.json --source-credential-id a11 --source-org-id 00D --json',
  ]

  static flags = {
    story: Flags.string({char: 's', description: 'User story owning the deployment steps.'}),
    'steps-file': Flags.string({description: 'JSON array of deployment steps for offline use.'}),
    'source-credential-id': Flags.string({description: 'Target org credential ID for member checks.', required: true}),
    'source-org-id': Flags.string({description: 'Target org ID for member checks.', required: true}),
    'pipeline-id': Flags.string({description: 'Pipeline ID scoping gateway calls.'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(RollbackSimulate)
    const story = (flags.story as string | undefined) ?? null
    const stepsFile = (flags['steps-file'] as string | undefined) ?? null
    const sCred = flags['source-credential-id'] as string
    const sOrg = flags['source-org-id'] as string
    const pipeline = (flags['pipeline-id'] as string | undefined) ?? null
    const asJson = (flags.json as boolean) ?? false

    if (!story && !stepsFile) {
      const detail = 'Pass --story for live steps or --steps-file for offline steps.'
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
        steps = rowsOf(JSON.parse(runAgentia(['cicd', 'work', 'deployment-step', 'list', '--user-story', story as string, '--json'])))
      } catch (error: any) {
        const detail = `Step listing failed: ${(error?.message ?? String(error)).split('\n')[0]}`
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
    }

    const members: Array<{type: string; name: string}> = []
    for (const step of steps) {
      const cands: any[] = Array.isArray(step?.members) ? step.members
        : Array.isArray(step?.metadata) ? step.metadata
        : Array.isArray(step?.files) ? step.files : []
      for (const m of cands) {
        if (typeof m === 'string' && m.includes('.')) {
          const [t, ...rest] = m.split('.')
          members.push({type: t, name: rest.join('.')})
        } else if (typeof m === 'object' && m !== null) {
          const t = str(m.metadataType || m.type)
          const n = str(m.metadataName || m.member || m.name || m.apiName)
          if (t !== '' && n !== '') members.push({type: t, name: n})
        }
      }
      if (members.length === 0) {
        const t = str(step?.metadataType || step?.type)
        const n = str(step?.metadataName || step?.member || step?.name)
        if (t !== '' && n !== '') members.push({type: t, name: n})
      }
    }

    const results: Array<{type: string; name: string; found: boolean; detail: string}> = []
    for (const m of members.slice(0, 30)) {
      try {
        const args = ['cicd', 'metadata', 'content', 'get', '--api-name', m.name,
          '--metadata-type', m.type, '--source-credential-id', sCred, '--source-org-id', sOrg, '--json']
        if (pipeline) args.push('--pipeline-id', pipeline)
        runAgentia(args, 45000)
        results.push({...m, found: true, detail: 'Present in the target org index.'})
      } catch (error: any) {
        const msg = (error?.message ?? String(error)).split('\n')[0]
        results.push({...m, found: /not found|404/i.test(msg), detail: msg.slice(0, 140)})
      }
    }

    const foundCount = results.filter((r) => r.found).length
    const coverage = members.length === 0 ? 100 : Math.round((foundCount / members.length) * 100)
    const score = members.length === 0 ? 100 : Math.max(0, Math.min(100,
      Math.round(coverage * 0.7 + (results.length >= members.length ? 20 : 0) + (steps.length > 0 ? 10 : 0))))
    const payload = {
      status: 'simulated',
      story,
      stepCount: steps.length,
      memberCount: members.length,
      checked: results.length,
      foundCount,
      confidence: `${score} (heuristic: ${(coverage)}% members resolvable weighted 70, full coverage check 20, non empty steps 10)`,
      results: results.slice(0, 30),
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
    } else {
      this.log(`Rollback simulation for ${story ?? 'offline steps'}: confidence ${score}, ${foundCount}/${members.length} members resolvable in target.`)
      for (const r of results.filter((x) => !x.found).slice(0, 10)) this.log(`  ? ${r.type} ${r.name}: ${r.detail}`)
      this.log('Heuristic score, not a guarantee. Generate the plan, review it, then act.')
    }
  }
}

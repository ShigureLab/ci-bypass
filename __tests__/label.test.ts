import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { getOctokit } from '@actions/github'
import { type PullRequestContext } from '../src/context.js'
import { LabelRule } from '../src/rules/label.js'

vi.mock('@actions/github', () => ({ getOctokit: vi.fn() }))
vi.mock('@actions/core', () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }))

const allLabel = 'ci-bypass/all'
const workflowLabel = 'ci-bypass/workflow'
const context = {
  githubToken: 'test-token',
  githubContext: { repo: { owner: 'example', repo: 'repo' }, issue: { number: 1 } },
} as PullRequestContext

interface LabelEvent {
  event: 'labeled' | 'unlabeled'
  label: { name: string }
  actor: { login: string }
}

const listEvents = vi.fn<() => Promise<{ data: LabelEvent[] }>>()
const listLabelsOnIssue = vi.fn<() => Promise<{ data: { name: string }[] }>>()
const listMembersInOrg = vi.fn<() => Promise<{ data: { login: string }[] }>>()

beforeEach(() => {
  vi.clearAllMocks()
  listMembersInOrg.mockResolvedValue({ data: [{ login: 'ci-member' }] })
  vi.mocked(getOctokit).mockReturnValue({
    rest: { issues: { listEvents, listLabelsOnIssue }, teams: { listMembersInOrg } },
    paginate: {
      async *iterator(method: () => Promise<{ data: unknown[] }>) {
        yield await method()
      },
    },
  } as unknown as ReturnType<typeof getOctokit>)
})

describe('LabelRule uses the latest actor for every matching label', () => {
  for (const labels of [
    [allLabel, workflowLabel],
    [workflowLabel, allLabel],
  ]) {
    describe(`current label order: ${labels.join(', ')}`, () => {
      it.each([
        { previousActor: 'ci-member', latestActor: 'outsider', expected: false },
        { previousActor: 'outsider', latestActor: 'ci-member', expected: true },
      ])(
        'returns $expected when $latestActor re-adds a label previously added by $previousActor',
        async ({ previousActor, latestActor, expected }) => {
          listEvents.mockResolvedValue({
            data: [
              { event: 'labeled', label: { name: workflowLabel }, actor: { login: previousActor } },
              { event: 'unlabeled', label: { name: workflowLabel }, actor: { login: 'outsider' } },
              { event: 'labeled', label: { name: allLabel }, actor: { login: 'outsider' } },
              { event: 'labeled', label: { name: workflowLabel }, actor: { login: latestActor } },
            ],
          })
          listLabelsOnIssue.mockResolvedValue({ data: labels.map((name) => ({ name })) })

          const rule = new LabelRule([allLabel, workflowLabel], undefined, 'ci')

          expect(await rule.check(context)).toBe(expected)
        }
      )
    })
  }
})

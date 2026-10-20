/**
 * Create an Epic → Feature → Product Backlog Item → Task hierarchy in Azure DevOps.
 *
 * Reads descriptions from operations-work-items.json. The PAT is prompted at runtime
 * (hidden input) and is never written to disk. Existing items with the same exact
 * title and work-item type are reused, making reruns safe.
 *
 * Run from this repository:
 *   pnpm exec ts-node scripts/azure-devops-operations-work-items.ts
 *   pnpm exec ts-node scripts/azure-devops-operations-work-items.ts -- --organization MescoMBDTeam --project Operation
 *
 * Optional preview:
 *   pnpm exec ts-node scripts/azure-devops-operations-work-items.ts -- --what-if
 */
import { stdin, stdout } from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

type WorkItemType = 'Epic' | 'Feature' | 'Product Backlog Item' | 'Task';

interface WorkItemSpec {
  title: string;
  description: string;
  tags?: string[];
}

interface BacklogItemSpec extends WorkItemSpec {}

interface TaskSpec extends WorkItemSpec {
  backlogItems: BacklogItemSpec[];
}

interface FeatureSpec extends WorkItemSpec {
  tasks: TaskSpec[];
}

interface EpicSpec extends WorkItemSpec {
  features: FeatureSpec[];
}

interface WorkItemDocument {
  assignedTo: string;
  epics: EpicSpec[];
}

interface AdoWorkItem {
  id: number;
  url: string;
  fields: Record<string, unknown>;
  relations?: Array<{ rel: string; url: string }>;
}

interface AdoCollection<T> {
  value: T[];
}

interface CreatedRecord {
  type: WorkItemType;
  id: number;
  title: string;
  url: string;
  reused: boolean;
}

interface Options {
  organization: string;
  project: string;
  sourceFile: string;
  outputFile: string;
  whatIf: boolean;
}

let previewOnly = false;

const scriptDirectory = dirname(resolve(process.argv[1] ?? __filename));
const defaultSource = join(scriptDirectory, 'operations-work-items.json');
const defaultOutput = join(scriptDirectory, 'operations-work-items-created.json');

function parseOptions(args: string[]): Options {
  const options: Options = {
    organization: 'MescoMBDTeam',
    project: 'D365FOMiddleware_Nestbackend',
    sourceFile: defaultSource,
    outputFile: defaultOutput,
    whatIf: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--what-if') options.whatIf = true;
    else if (arg === '--organization') options.organization = args[++index] ?? '';
    else if (arg === '--project') options.project = args[++index] ?? '';
    else if (arg === '--source') options.sourceFile = resolve(args[++index] ?? '');
    else if (arg === '--output') options.outputFile = resolve(args[++index] ?? '');
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Options: --organization <name> --project <name> --source <json> --output <json> --what-if',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  previewOnly = options.whatIf;
  if (!options.organization || !options.project) {
    throw new Error('Organization and project must be non-empty.');
  }
  return options;
}

async function readPat(): Promise<string> {
  if (process.env.AZDO_PAT) {
    const pat = process.env.AZDO_PAT;
    delete process.env.AZDO_PAT;
    return pat;
  }

  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(
      'No interactive terminal is available. Run this script in PowerShell/Terminal, or set AZDO_PAT for this process.',
    );
  }

  return new Promise<string>((resolvePat, rejectPat) => {
    stdout.write('Azure DevOps PAT (input hidden): ');
    stdin.setRawMode(true);
    stdin.resume();
    let pat = '';
    const cleanup = () => {
      stdin.off('data', onData);
      stdin.off('error', onError);
      if (stdin.isRaw) stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onError = (error: Error) => {
      cleanup();
      rejectPat(error);
    };
    const onData = (chunk: Buffer) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          rejectPat(new Error('PAT entry was cancelled.'));
          return;
        }
        if (byte === 13 || byte === 10) {
          cleanup();
          if (!pat) rejectPat(new Error('A non-empty PAT is required.'));
          else resolvePat(pat);
          return;
        }
        if (byte === 8 || byte === 127) pat = pat.slice(0, -1);
        else pat += String.fromCharCode(byte);
      }
    };
    stdin.on('data', onData);
    stdin.on('error', onError);
  });
}

class AzureDevOpsClient {
  private readonly baseUrl: string;
  private readonly authorization: string;

  constructor(
    private readonly organization: string,
    private readonly project: string,
    pat: string,
  ) {
    this.baseUrl = `https://dev.azure.com/${encodeURIComponent(organization)}`;
    this.authorization = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
  }

  private async request<T>(
    url: string,
    method: 'GET' | 'POST' | 'PATCH',
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: this.authorization,
        Accept: 'application/json',
        ...(body === undefined
          ? {}
          : {
              'Content-Type':
                method === 'PATCH'
                  ? 'application/json-patch+json'
                  : 'application/json',
            }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1200);
      if (response.status === 301 || response.status === 302 || response.status === 203) {
        throw new Error(
          `Azure DevOps redirected the request to sign-in (HTTP ${response.status}). Check PAT validity and scopes.`,
        );
      }
      throw new Error(
        `Azure DevOps returned HTTP ${response.status} for ${method} ${url}: ${detail}`,
      );
    }
    return (await response.json()) as T;
  }

  async verifyAuthentication(): Promise<void> {
    const url = `${this.baseUrl}/_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1`;
    await this.request(url, 'GET');
  }

  async verifyProject(): Promise<void> {
    const response = await this.request<AdoCollection<{ name: string }>>(
      `${this.baseUrl}/_apis/projects?api-version=7.1`,
      'GET',
    );
    const matches = response.value.filter(
      (project) => project.name.toLowerCase() === this.project.toLowerCase(),
    );
    if (matches.length !== 1) {
      const visibleProjects = response.value.map(({ name }) => name).join(', ');
      throw new Error(
        `Project '${this.project}' was not found or is ambiguous. Projects visible to this PAT: ${visibleProjects || '(none)'}`,
      );
    }
  }

  async findByTitle(title: string, type: WorkItemType): Promise<AdoWorkItem | undefined> {
    const escapedTitle = title.replaceAll("'", "''");
    const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = '${type}' AND [System.Title] = '${escapedTitle}'`;
    const endpoint = `${this.baseUrl}/${encodeURIComponent(this.project)}/_apis/wit/wiql?api-version=7.1`;
    const result = await this.request<{
      workItems: Array<{ id: number }>;
    }>(endpoint, 'POST', { query });
    const match = result.workItems[0];
    if (!match) return undefined;
    return this.request<AdoWorkItem>(
      `${this.baseUrl}/${encodeURIComponent(this.project)}/_apis/wit/workitems/${match.id}?api-version=7.1&$expand=relations`,
      'GET',
    );
  }

  async createWorkItem(
    type: WorkItemType,
    spec: WorkItemSpec,
    assignedTo: string,
    parentUrl?: string,
  ): Promise<{ item: AdoWorkItem; reused: boolean }> {
    const existing = await this.findByTitle(spec.title, type);
    const operations: Array<Record<string, unknown>> = [
      { op: 'add', path: '/fields/System.Title', value: spec.title },
      { op: 'add', path: '/fields/System.Description', value: spec.description },
      { op: 'add', path: '/fields/System.AssignedTo', value: assignedTo },
      { op: 'add', path: '/fields/System.State', value: 'Done' },
    ];
    if (spec.tags?.length) {
      operations.push({
        // Azure DevOps treats add on System.Tags as an append. Replace the full
        // list so removed tags do not remain on existing work items.
        op: existing ? 'replace' : 'add',
        path: '/fields/System.Tags',
        value: spec.tags.join('; '),
      });
    }
    if (parentUrl) {
      const hasParent = existing?.relations?.some(
        (relation) =>
          relation.rel === 'System.LinkTypes.Hierarchy-Reverse' &&
          relation.url.replace(/\/$/, '') === parentUrl.replace(/\/$/, ''),
      );
      if (!hasParent) {
        operations.push({
          op: 'add',
          path: '/relations/-',
          value: {
            rel: 'System.LinkTypes.Hierarchy-Reverse',
            url: parentUrl,
            attributes: { comment: 'Parent work item' },
          },
        });
      }
    }

    if (previewOnly) {
      console.log(`What if: ${existing ? 'update' : 'create'} ${type}: ${spec.title}`);
      return {
        item: {
          id: 0,
          url: '',
          fields: { 'System.Title': spec.title },
        },
        reused: false,
      };
    }

    if (existing) {
      const updated = await this.request<AdoWorkItem>(
        `${existing.url}?api-version=7.1`,
        'PATCH',
        operations,
      );
      console.log(`Updated ${type} #${updated.id}: ${spec.title}`);
      return { item: updated, reused: true };
    }

    const endpoint = `${this.baseUrl}/${encodeURIComponent(this.project)}/_apis/wit/workitems/$${encodeURIComponent(type)}?api-version=7.1`;
    const item = await this.request<AdoWorkItem>(endpoint, 'PATCH', operations);
    console.log(`Created ${type} #${item.id}: ${spec.title}`);
    return { item, reused: false };
  }
}

async function createHierarchy(
  client: AzureDevOpsClient,
  document: WorkItemDocument,
  whatIf: boolean,
): Promise<CreatedRecord[]> {
  if (!document.assignedTo) {
    throw new Error('The work-item document must specify an assignee.');
  }
  const records: CreatedRecord[] = [];
  for (const epicSpec of document.epics) {
    const epicResult = await client.createWorkItem(
      'Epic',
      epicSpec,
      document.assignedTo,
    );
    const epic = epicResult.item;
    if (epic.id) {
      records.push({
        type: 'Epic',
        id: epic.id,
        title: epicSpec.title,
        url: epic.url,
        reused: epicResult.reused,
      });
    }

    for (const featureSpec of epicSpec.features) {
      const featureResult = await client.createWorkItem(
        'Feature',
        featureSpec,
        document.assignedTo,
        epic.url || undefined,
      );
      const feature = featureResult.item;
      if (feature.id) {
        records.push({
          type: 'Feature',
          id: feature.id,
          title: featureSpec.title,
          url: feature.url,
          reused: featureResult.reused,
        });
      }

      for (const taskSpec of featureSpec.tasks) {
        const taskResult = await client.createWorkItem(
          'Task',
          taskSpec,
          document.assignedTo,
          feature.url || undefined,
        );
        const task = taskResult.item;
        if (task.id) {
          records.push({
            type: 'Task',
            id: task.id,
            title: taskSpec.title,
            url: task.url,
            reused: taskResult.reused,
          });
        }

        for (const backlogSpec of taskSpec.backlogItems) {
          const backlogResult = await client.createWorkItem(
            'Product Backlog Item',
            backlogSpec,
            document.assignedTo,
            task.url || undefined,
          );
          const backlog = backlogResult.item;
          if (backlog.id) {
            records.push({
              type: 'Product Backlog Item',
              id: backlog.id,
              title: backlogSpec.title,
              url: backlog.url,
              reused: backlogResult.reused,
            });
          }
        }
      }
    }
  }
  if (whatIf) console.log('Preview complete. No Azure work items were created.');
  return records;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const source = JSON.parse(
    await readFile(options.sourceFile, 'utf8'),
  ) as WorkItemDocument;
  if (!Array.isArray(source.epics) || source.epics.length === 0) {
    throw new Error(`No epics found in ${options.sourceFile}`);
  }

  const pat = await readPat();
  const client = new AzureDevOpsClient(options.organization, options.project, pat);
  try {
    await client.verifyAuthentication();
    await client.verifyProject();
    console.log(
      `Verified Azure DevOps access to ${options.organization}/${options.project}.`,
    );
    const records = await createHierarchy(client, source, options.whatIf);
    if (!options.whatIf) {
      await writeFile(options.outputFile, JSON.stringify(records, null, 2), 'utf8');
      console.log(`Saved ${records.length} work-item references to ${options.outputFile}`);
    }
  } finally {
    // Reduce the lifetime of the raw credential; Authorization remains only in client scope.
    // The client itself becomes unreachable when main exits.
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

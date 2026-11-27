import json, re, os, sys
B = '/workspace/projects/34477757-df72-41f7-aa54-85fcbf831943/bots'
rows = []
for line in open(f'{B}/roster.md'):
    if not line.startswith('|') or line.startswith('|---') or line.startswith('| Bot |'): continue
    cells = [c.strip() for c in line.strip().strip('|').split('|')]
    bot, task, ver, score, status = cells[:5]
    m = re.match(r'(.*?)\s*\(`([^`/]+)/?`\)', bot)
    name, folder = m.group(1), m.group(2)
    slug = folder.replace('-bot', '') if False else folder
    prompt = open(f'{B}/{folder}/prompt.md').read()
    cfgp = f'{B}/{folder}/config.example.json'
    cfg = json.load(open(cfgp)) if os.path.exists(cfgp) else {}
    rows.append(dict(slug=folder, name=name, one_task=task, version=ver, score=score,
                     status='test' if folder == 'missedcall-bot' else 'off', prompt=prompt, config=cfg))
def q(s): return "$q$" + s + "$q$"
vals = ",\n".join(f"({q(r['slug'])},{q(r['name'])},{q(r['one_task'])},{q(r['version'])},{q(r['score'])},{q(r['status'])},{q(r['prompt'])},{q(json.dumps(r['config']))}::jsonb)" for r in rows)
sql = f"""insert into public.bots (slug,name,one_task,version,score,status,prompt,config) values
{vals}
on conflict (slug) do update set name=excluded.name, one_task=excluded.one_task, version=excluded.version,
 score=excluded.score, prompt=excluded.prompt, config=excluded.config, updated_at=now();"""
print(json.dumps({'query': sql}))
print(len(rows), file=sys.stderr)

#!/usr/bin/env python3
"""Search Console reports for rinkhockeyil.com (sc-domain property) via the play-publisher service account
(added as a restricted user in GSC on 2026-11-09; Search Console API enabled in project rinkhockeyil).

Usage:
  python3 scripts/gsc_report.py summary|queries|pages|countries|devices|weekly|sitemaps [days]
  python3 scripts/gsc_report.py inspect <url>
  python3 scripts/gsc_report.py '<searchAnalytics query JSON body>'
Search data lags ~2-3 days. No pip deps (openssl-signed JWT).
"""
import base64, datetime, json, subprocess, sys, tempfile, time, urllib.parse, urllib.request

KEY = '/Users/arielbiton/.config/rinkhockey/play-publisher.json'
SITE = 'sc-domain:rinkhockeyil.com'
API = 'https://www.googleapis.com/webmasters/v3/sites/' + urllib.parse.quote(SITE, safe='')


def token():
    k = json.load(open(KEY))
    b = lambda d: base64.urlsafe_b64encode(d).rstrip(b'=')
    now = int(time.time())
    head = b(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    body = b(json.dumps({'iss': k['client_email'], 'scope': 'https://www.googleapis.com/auth/webmasters.readonly',
                         'aud': k['token_uri'], 'iat': now, 'exp': now + 3600}).encode())
    with tempfile.NamedTemporaryFile('w') as f:
        f.write(k['private_key']); f.flush()
        sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', f.name], input=head + b'.' + body,
                             capture_output=True, check=True).stdout
    data = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                   'assertion': (head + b'.' + body + b'.' + b(sig)).decode()}).encode()
    return json.load(urllib.request.urlopen(k['token_uri'], data))['access_token']


def call(url, body=None):
    req = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None,
                                 {'Authorization': f'Bearer {token()}', 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(req))


def presets(name, days):
    end = datetime.date.today()
    rng = {'startDate': str(end - datetime.timedelta(days=days)), 'endDate': str(end)}
    dims = {'summary': [], 'queries': ['query'], 'pages': ['page'], 'countries': ['country'],
            'devices': ['device'], 'weekly': ['date']}[name]
    return {**rng, 'dimensions': dims, 'rowLimit': 1000}


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else 'summary'
    if arg == 'sitemaps':
        for s in call(API + '/sitemaps').get('sitemap', []):
            print(s['path'], s.get('lastDownloaded'), s.get('contents'))
        return
    if arg == 'inspect':
        r = call('https://searchconsole.googleapis.com/v1/urlInspection/index:inspect',
                 {'inspectionUrl': sys.argv[2], 'siteUrl': SITE})
        print(json.dumps(r['inspectionResult'].get('indexStatusResult'), ensure_ascii=False, indent=1))
        return
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 28
    body = json.loads(arg) if arg.lstrip().startswith('{') else presets(arg, days)
    rows = call(API + '/searchAnalytics/query', body).get('rows', [])
    if arg == 'weekly':  # roll daily rows up to ISO weeks
        wk = {}
        for r in rows:
            y, w, _ = datetime.date.fromisoformat(r['keys'][0]).isocalendar()
            a = wk.setdefault(f'{y}-W{w:02d}', [0, 0])
            a[0] += r['clicks']; a[1] += r['impressions']
        print('week | clicks | impressions')
        for k in sorted(wk):
            print(k, '|', wk[k][0], '|', wk[k][1])
        return
    print(' | '.join(body.get('dimensions', [])), '| clicks | impressions | ctr | position')
    for r in rows:
        print(' | '.join(r.get('keys', [])), '|', r['clicks'], '|', r['impressions'], '|',
              f"{r['ctr']:.1%}", '|', f"{r['position']:.1f}")


if __name__ == '__main__':
    main()

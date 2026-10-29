#!/usr/bin/env python3
"""GA4 reports for rinkhockeyil.com (property 545218402) via the play-publisher service account.

Usage:
  python3 scripts/ga_report.py summary|pages|sources|countries|daily [days]
  python3 scripts/ga_report.py '<runReport JSON body>'
No pip deps: the JWT is signed with openssl.
"""
import base64, json, subprocess, sys, tempfile, time, urllib.parse, urllib.request

KEY = '/Users/arielbiton/.config/rinkhockey/play-publisher.json'
PROPERTY = '545218402'


def token():
    k = json.load(open(KEY))
    b = lambda d: base64.urlsafe_b64encode(d).rstrip(b'=')
    now = int(time.time())
    head = b(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    body = b(json.dumps({'iss': k['client_email'], 'scope': 'https://www.googleapis.com/auth/analytics.readonly',
                         'aud': k['token_uri'], 'iat': now, 'exp': now + 3600}).encode())
    with tempfile.NamedTemporaryFile('w') as f:
        f.write(k['private_key']); f.flush()
        sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', f.name], input=head + b'.' + body,
                             capture_output=True, check=True).stdout
    data = urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                                   'assertion': (head + b'.' + body + b'.' + b(sig)).decode()}).encode()
    return json.load(urllib.request.urlopen(k['token_uri'], data))['access_token']


def presets(name, days):
    rng = [{'startDate': f'{days}daysAgo', 'endDate': 'today'}]
    top = lambda dim, metric, n=15: {'dateRanges': rng, 'dimensions': [{'name': dim}], 'metrics': [{'name': metric}],
                                     'orderBys': [{'metric': {'metricName': metric}, 'desc': True}], 'limit': n}
    return {
        'summary': {'dateRanges': rng, 'metrics': [{'name': m} for m in
                    ('activeUsers', 'newUsers', 'sessions', 'screenPageViews', 'averageSessionDuration')]},
        'pages': top('pagePath', 'screenPageViews'),
        'sources': top('sessionSourceMedium', 'sessions'),
        'countries': top('country', 'activeUsers'),
        'daily': {'dateRanges': rng, 'dimensions': [{'name': 'date'}], 'metrics': [{'name': 'activeUsers'},
                  {'name': 'screenPageViews'}], 'orderBys': [{'dimension': {'dimensionName': 'date'}}]},
    }[name]


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else 'summary'
    days = int(sys.argv[2]) if len(sys.argv) > 2 else 7
    body = json.loads(arg) if arg.lstrip().startswith('{') else presets(arg, days)
    req = urllib.request.Request(f'https://analyticsdata.googleapis.com/v1beta/properties/{PROPERTY}:runReport',
                                 json.dumps(body).encode(), {'Authorization': f'Bearer {token()}',
                                                             'Content-Type': 'application/json'})
    d = json.load(urllib.request.urlopen(req))
    print(' | '.join(h['name'] for h in d.get('dimensionHeaders', []) + d['metricHeaders']))
    for r in d.get('rows', []):
        print(' | '.join(v['value'] for v in r.get('dimensionValues', []) + r['metricValues']))


if __name__ == '__main__':
    main()

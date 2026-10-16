"""Screenshots of the new screens (sign-in, the rules card, the move, the app signed in, Settings), for looking at them.
    npx firebase emulators:exec --only firestore,auth,database --project demo-nlo-cases "python3 test/shots.py <folder>"
"""
import sys, os, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2e
from e2e import *

def main():
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    srv = serve()
    req('DELETE', 'http://127.0.0.1:8080/emulator/v1/projects/' + P + '/databases/(default)/documents')
    req('DELETE', 'http://127.0.0.1:9099/emulator/v1/projects/' + P + '/accounts')
    c, j = req('PUT', RT + '/.settings/rules.json?ns=' + P, json.loads((HERE / 'rtdb.rules.json').read_text()))
    seed_people(); seed_old()
    with sync_playwright() as p:
        b = p.chromium.launch()
        for w, h, tag in [(1366, 860, 'desk'), (390, 844, 'phone')]:
            ctx, pg, errs = new_page(b, w=w, h=h, quiet=True)
            pg.goto(PAGE); pg.wait_for_selector('#lgUser'); pg.fill('#lgUser', 'amir'); pg.wait_for_timeout(300)
            pg.screenshot(path=out + '/1-signin-%s.png' % tag)
            old = subprocess.run(['git', 'show', 'HEAD:nlo-cases-src/firestore.rules'], cwd=SRC.parent, capture_output=True, text=True).stdout.replace('__OWNER_EMAIL__', 'dr.test@example.com')
            set_rules(old)
            sign_in(pg, 'amir', wait_app=False); pg.wait_for_function("() => S.gate === 'rules'", timeout=15000); pg.wait_for_timeout(300)
            pg.screenshot(path=out + '/2-rules-%s.png' % tag, full_page=True)
            set_rules((DIST / 'firestore.rules').read_text())
            J(pg, "ACT.retryOpen()"); pg.wait_for_function("() => S.gate === 'move'", timeout=15000); pg.wait_for_timeout(300)
            pg.screenshot(path=out + '/3-move-start-%s.png' % tag, full_page=True)
            pg.click('[data-act="mvConnect"]'); pg.wait_for_function("() => MV.step === 'ready'", timeout=20000); pg.wait_for_timeout(300)
            pg.screenshot(path=out + '/4-move-ready-%s.png' % tag, full_page=True)
            if tag == 'desk':
                pg.click('[data-act="mvGo"]'); pg.wait_for_selector('#cbYes'); pg.click('#cbYes')
                pg.wait_for_function("() => MV.step === 'done'", timeout=30000); pg.wait_for_timeout(300)
                pg.screenshot(path=out + '/5-move-done-%s.png' % tag, full_page=True)
                pg.click('[data-act="mvOpen"]'); pg.wait_for_function("() => allLoaded()", timeout=15000); pg.wait_for_timeout(800)
                pg.screenshot(path=out + '/6-home-%s.png' % tag)
                J(pg, "go('settings')"); pg.wait_for_timeout(800)
                pg.screenshot(path=out + '/7-settings-%s.png' % tag, full_page=True)
            else:
                J(pg, "ACT.lock()"); pg.wait_for_selector('#lgPw')
                sign_in(pg, 'gwen'); pg.wait_for_timeout(600)
                pg.screenshot(path=out + '/6-home-%s.png' % tag)
                J(pg, "ACT.who()"); pg.wait_for_timeout(300)
                pg.screenshot(path=out + '/8-who-%s.png' % tag)
            print(tag, 'errors:', errs)
            ctx.close()
        b.close()
    srv.shutdown()

if __name__ == '__main__':
    main()

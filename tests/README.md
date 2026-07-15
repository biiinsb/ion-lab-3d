# 테스트

> **앱을 실행하려는 것이라면 이 폴더가 아니라 [`../index.html`](../index.html)을 열어야 한다.**
> 이 폴더의 파일들은 테스트 하네스이며, 화면에 앱이 보이더라도 그건 테스트가 검사하려고
> iframe에 띄운 것이다.

빌드 도구도 러너도 없다. 브라우저로 파일을 열면 그게 실행이다.

| 파일 | 내용 | 단언 수 | 그냥 열어도 되나 |
| :--- | :--- | ---: | :--- |
| `rules.test.html` | 데이터 정합성 + 규칙 엔진 단위 테스트 (`atoms.js`, `rules.js`) | 348 | ✅ 된다 |
| `app.test.html` | 실제 앱을 iframe에 띄워 드래그·판정·화합물까지 구동하는 통합 테스트 | 80 | ❌ 아래 참고 |
| `responsive.html` | 모바일(414px)·태블릿(834px) 레이아웃 육안 확인용 | — | ✅ 된다 |

## 실행

`rules.test.html`은 브라우저로 열면 바로 결과가 나온다.

`app.test.html`은 iframe 안의 `../index.html`을 들여다봐야 한다. `file://`로 그냥 열면
Chrome이 파일마다 별도의 출처로 취급해 iframe 접근이 차단되고, 테스트가 실행되지 않는다
(이 경우 페이지가 이유와 해결법을 표시한다). 로컬 서버로 여는 편이 가장 간단하다.

```powershell
# 프로젝트 루트에서
py -m http.server 8000
# → http://localhost:8000/tests/app.test.html
```

```powershell
# 헤드리스로 두 테스트를 한 번에 돌리기
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
foreach ($t in @('rules', 'app')) {
    $dom = & $chrome --headless=new --disable-gpu --allow-file-access-from-files `
        --virtual-time-budget=15000 --window-size=1400,1000 `
        --dump-dom "file:///c:/Antigravty/tests/$t.test.html" | Out-String
    if ($dom -match 'RESULT ([^\n<]*)') { "$t -> $($matches[1])" }
}
```

## 무엇을 지키고 있는가

테스트는 PRD 19장(수용 기준)과 20장(완료 정의)에 직접 대응한다. 특히 아래 항목은
기존 프로토타입에서 실제로 깨져 있던 부분이라 회귀 테스트로 못 박아 두었다.

- **산소를 선택하고 아무것도 하지 않으면 즉시 `O²⁻` 성공 판정이 났다.** 중성 산소의
  전자 수(8)를 목표 전자 수로 잘못 넣어서다. N·F도 같은 오류였다.
  → `rules.test.html` 3절
- **안쪽 껍질(K·L) 전자도 자유롭게 뽑을 수 있었다.** PRD 7.1 위반.
  → `app.test.html` B절
- **터치로는 전자를 버릴 수 없었다.** `touchend`에서 `changedTouches`를 읽지 않아
  좌표가 `undefined`였다. → `app.test.html` H절

테스트가 하나라도 빨간불이면 그건 사양 위반이다. 테스트를 고치기 전에 코드를 의심하라.
단, 좌표를 다루는 통합 테스트는 모드에 따라 레이아웃이 바뀌므로(연습 모드의 미션 바가
자유 탐색에서는 사라진다) `getBoundingClientRect()`를 매번 다시 재야 한다.

# money_plan

가계부 REST API. Express + Sequelize(MySQL) + Passport(세션 로그인)으로 만들었고, 간단한 화면과 API 테스트 페이지가 함께 들어 있습니다.

## 실행

```bash
npm install
npm run db:create   # money_plan, money_plan_test 데이터베이스 생성 (최초 1회)
npm start           # http://localhost:3000
```

- DB 접속 정보: `config/config.json` (`development`는 실행용, `test`는 테스트용)
- 포트와 세션 비밀키: `.env` 의 `PORT`, `SECRET`
- 테이블은 서버를 시작할 때 자동으로 만들어집니다.

| 주소 | 내용 |
|------|------|
| `http://localhost:3000/` | 가계부 화면 |
| `http://localhost:3000/test.html` | API 테스트 페이지 (41개 API를 골라서 바로 호출) |

## 테스트

```bash
npm test                 # 전체 (58개)
npm run test-auth        # 라우터 하나만: auth, transactions, categories, accounts, budgets, stats
npx mocha --exit -f POST test/transactions.js   # 이름에 POST가 들어간 테스트만
```

테스트는 `money_plan_test` DB의 테이블을 매번 새로 만들기 때문에 실행용 데이터는 건드리지 않습니다.

## 공통 규칙

- 요청과 응답은 모두 JSON입니다. (`Content-Type: application/json`)
- `/auth/signup`, `/auth/login` 을 뺀 모든 API는 로그인이 필요합니다. 로그인하면 `session-cookie` 쿠키가 발급되고, 이후 요청에 이 쿠키를 함께 보내면 됩니다.
- 모든 데이터는 로그인한 사용자 것만 보이고, 남의 데이터는 `404`로 응답합니다.
- 금액은 원 단위 정수, 날짜는 `YYYY-MM-DD`, 월은 `YYYY-MM` 형식입니다.
- 구분(`type`)은 `income`(수입) 또는 `expense`(지출)입니다.
- 오류 응답은 `{ "message": "이유" }` 형태입니다.

| 상태 코드 | 의미 |
|-----------|------|
| 200 / 201 | 성공 / 생성됨 |
| 400 | 값이 잘못됨 |
| 401 | 로그인 필요, 또는 로그인 실패 |
| 404 | 없거나 내 것이 아님 |
| 409 | 중복, 또는 거래가 연결되어 삭제할 수 없음 |

### curl 로 써 보기

```bash
# 회원가입 -> 로그인 (쿠키를 cookie.txt 에 저장)
curl -X POST localhost:3000/auth/signup -H 'Content-Type: application/json' \
  -d '{"id":"hong","password":"password1234","name":"홍길동"}'
curl -X POST localhost:3000/auth/login -c cookie.txt -H 'Content-Type: application/json' \
  -d '{"id":"hong","password":"password1234"}'

# 이후에는 -b cookie.txt 로 쿠키를 함께 보낸다
curl -b cookie.txt localhost:3000/categories
curl -b cookie.txt -X POST localhost:3000/transactions -H 'Content-Type: application/json' \
  -d '{"type":"expense","amount":12000,"date":"2026-11-05","categoryId":1,"memo":"점심"}'
curl -b cookie.txt 'localhost:3000/stats/monthly?month=2026-11'
```

## 1. auth

| 메서드 | 경로 | 설명 | 보내는 값 |
|--------|------|------|-----------|
| POST | `/auth/signup` | 회원가입. 기본 카테고리 10개가 자동 생성됨 | `id`, `password`(8자 이상), `name`, `description`(선택) |
| POST | `/auth/login` | 로그인 | `id`, `password` |
| POST | `/auth/logout` | 로그아웃 | |
| GET | `/auth/me` | 내 정보 조회 | |
| PATCH | `/auth/me` | 내 정보 수정 | `name`, `description` 중 바꿀 것 |
| PATCH | `/auth/me/password` | 비밀번호 변경 | `currentPassword`, `newPassword` |
| DELETE | `/auth/me` | 회원 탈퇴. 내 데이터가 모두 삭제됨 | |

기본 카테고리: 지출(식비, 교통, 주거/통신, 쇼핑, 문화/여가, 의료/건강, 기타), 수입(월급, 용돈, 기타수입)

## 2. transactions

| 메서드 | 경로 | 설명 |
|--------|------|------|
| POST | `/transactions` | 거래 등록 |
| POST | `/transactions/bulk` | 여러 건 일괄 등록 |
| GET | `/transactions` | 목록 조회 |
| GET | `/transactions/recent` | 최근 거래 N건 |
| GET | `/transactions/export` | CSV 내보내기 |
| GET | `/transactions/:id` | 상세 조회 |
| PATCH | `/transactions/:id` | 수정 |
| DELETE | `/transactions/:id` | 삭제 |

**등록 / 수정할 때 보내는 값**

| 이름 | 필수 | 설명 |
|------|------|------|
| `type` | O | `income` 또는 `expense` |
| `amount` | O | 1 이상의 정수 |
| `categoryId` | O | 내 카테고리. 거래의 구분과 카테고리의 구분이 같아야 함 |
| `date` | | 없으면 오늘 |
| `accountId` | | 결제수단. 없어도 됨 |
| `memo` | | 200자 이하 |

수정(PATCH)은 바꿀 항목만 보내면 됩니다.

```jsonc
// POST /transactions/bulk - 하나라도 잘못되면 전부 등록되지 않음 (최대 100건)
{ "transactions": [
    { "type": "expense", "amount": 1500, "date": "2026-11-02", "categoryId": 2, "memo": "버스" },
    { "type": "income", "amount": 3000000, "date": "2026-11-01", "categoryId": 8 }
] }
```

**목록 조회 쿼리** (`GET /transactions`, `/transactions/export` 공통)

| 쿼리 | 설명 |
|------|------|
| `month` | 한 달 (`2026-11`) |
| `from`, `to` | 기간 (`month` 대신 사용) |
| `type` | `income` / `expense` |
| `categoryId`, `accountId` | 카테고리, 결제수단 |
| `q` | 메모 검색 |
| `page`, `limit` | 페이지네이션. 기본 1, 20 (최대 100) |

```jsonc
// GET /transactions?month=2026-11&q=점심&page=1&limit=20
{ "total": 1, "page": 1, "limit": 20, "totalPages": 1,
  "items": [ { "id": 1, "type": "expense", "amount": 12000, "date": "2026-11-05", "memo": "점심",
               "Category": { "id": 1, "name": "식비", "type": "expense" },
               "Account": { "id": 1, "name": "통장", "type": "bank" } } ] }
```

- `GET /transactions/recent?limit=5` : 최근 거래. 기본 5건, 최대 50건
- `GET /transactions/export` : `날짜,구분,카테고리,결제수단,금액,메모` 열을 가진 CSV 파일을 내려받습니다.
- 계좌 이체로 생긴 거래는 수정할 수 없고, 한쪽을 삭제하면 짝이 되는 거래도 함께 삭제됩니다.

## 3. categories

| 메서드 | 경로 | 설명 | 보내는 값 / 쿼리 |
|--------|------|------|------------------|
| POST | `/categories` | 생성 | `name`, `type` |
| GET | `/categories` | 목록 조회 | `?type=income\|expense` |
| PATCH | `/categories/:id` | 수정 | `name`, `type` 중 바꿀 것 |
| DELETE | `/categories/:id` | 삭제. 거래가 연결되어 있으면 `409` | |
| GET | `/categories/:id/transactions` | 해당 카테고리 거래 목록 | 거래 목록 조회와 같은 쿼리 |
| GET | `/categories/:id/summary` | 기간별 합계와 거래 건수 | `?month=` 또는 `?from=&to=` (없으면 전체 기간) |

```jsonc
// GET /categories/1/summary?month=2026-11
{ "categoryId": 1, "name": "식비", "type": "expense",
  "from": "2026-11-01", "to": "2026-11-30", "total": 100000, "count": 2 }
```

## 4. accounts

| 메서드 | 경로 | 설명 | 보내는 값 / 쿼리 |
|--------|------|------|------------------|
| POST | `/accounts` | 결제수단 등록 | `name`, `type`(`cash`/`bank`/`card`/`etc`, 기본 `bank`), `initialBalance`(기본 0) |
| GET | `/accounts` | 목록 조회. 현재 잔액 `balance` 포함 | |
| PATCH | `/accounts/:id` | 수정 | `name`, `type`, `initialBalance` 중 바꿀 것 |
| DELETE | `/accounts/:id` | 삭제. 거래가 연결되어 있으면 `409` | |
| GET | `/accounts/:id/balance` | 특정 시점 잔액 | `?date=2026-11-15` (없으면 오늘) |
| GET | `/accounts/:id/transactions` | 해당 결제수단 거래 목록 | 거래 목록 조회와 같은 쿼리 |
| POST | `/accounts/transfer` | 계좌 간 이체 | `fromAccountId`, `toAccountId`, `amount`, `date`(선택), `memo`(선택) |

- 잔액 = 시작 잔액(`initialBalance`) + 수입 - 지출
- 이체는 출금 거래와 입금 거래 두 건이 한 트랜잭션으로 함께 기록됩니다. 잔액에는 반영되지만 통계와 예산에서는 제외됩니다.

```jsonc
// POST /accounts/transfer
{ "fromAccountId": 1, "toAccountId": 2, "amount": 30000, "date": "2026-11-10" }
// 응답 201
{ "transferId": "…", "withdrawal": { "id": 10, "type": "expense", "accountId": 1 },
  "deposit": { "id": 11, "type": "income", "accountId": 2 } }
```

## 5. budgets

| 메서드 | 경로 | 설명 | 보내는 값 / 쿼리 |
|--------|------|------|------------------|
| POST | `/budgets` | 예산 설정. 지출 카테고리만, 한 달에 카테고리당 하나 | `month`, `categoryId`, `amount` |
| GET | `/budgets` | 목록 조회 | `?month=2026-11` (없으면 전체) |
| PATCH | `/budgets/:id` | 금액 수정 | `amount` |
| DELETE | `/budgets/:id` | 삭제 | |
| GET | `/budgets/status` | 예산 대비 지출 소진율 | `?month=` (없으면 이번 달) |
| GET | `/budgets/alerts` | 초과했거나 80% 이상 쓴 예산 | `?month=` (없으면 이번 달) |
| POST | `/budgets/copy-previous` | 전월 예산을 복사. 이미 예산이 있는 카테고리는 건너뜀 | `month`(복사해 올 달, 없으면 이번 달) |

```jsonc
// GET /budgets/status?month=2026-11
{ "month": "2026-11",
  "total": { "amount": 700000, "spent": 435000, "remaining": 265000, "rate": 62.1 },
  "items": [ { "id": 1, "categoryId": 1, "categoryName": "식비",
               "amount": 400000, "spent": 100000, "remaining": 300000, "rate": 25 } ] }
```

`/budgets/alerts` 는 같은 항목에 `level` 이 붙습니다. 예산을 넘겼으면 `exceeded`, 80% 이상이면 `warning` 입니다.

## 6. stats

모든 통계는 계좌 이체를 뺀 거래만 계산합니다. `month` 가 없으면 이번 달입니다.

| 메서드 | 경로 | 설명 | 쿼리 |
|--------|------|------|------|
| GET | `/stats/monthly` | 월 총수입, 총지출, 잔액 | `month` |
| GET | `/stats/daily` | 일별 수입·지출 (달력용, 거래가 있는 날만) | `month` |
| GET | `/stats/by-category` | 카테고리별 금액과 비중(%) | `month`, `type`(기본 `expense`) |
| GET | `/stats/trend` | 최근 N개월 추이 (이번 달 포함) | `months`(기본 6, 최대 24) |
| GET | `/stats/top-expenses` | 지출 상위 N건 | `month`, `limit`(기본 5) |
| GET | `/stats/by-account` | 결제수단별 사용액 | `month` |

```jsonc
// GET /stats/monthly?month=2026-11
{ "month": "2026-11", "income": 3000000, "expense": 100000, "balance": 2900000 }

// GET /stats/by-category?month=2026-11
{ "month": "2026-11", "type": "expense", "total": 100000,
  "items": [ { "categoryId": 1, "name": "식비", "total": 60000, "count": 2, "ratio": 60 } ] }
```

## 폴더 구조

```
app.js            서버 설정, 라우터 연결, 에러 처리
config/           DB 접속 정보
models/           User, Category, Account, Transaction, Budget
passport/         로그인 전략 (아이디 + 비밀번호)
routes/           라우터 6개 + 공통 함수(helpers.js)
public/           가계부 화면(index.html), API 테스트 페이지(test.html)
test/             라우터별 API 테스트
```

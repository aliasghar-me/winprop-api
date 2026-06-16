# i18n Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Localize all user-facing API error messages by `Accept-Language` header (and authenticated user preference) using `nestjs-i18n`, without changing machine error codes, and add a `PATCH /me/language` endpoint.

**Architecture:** `nestjs-i18n` is added to `AppModule` with three resolvers in priority order: `UserPreferenceResolver` (reads `req.user?.preferredLanguage`) > `AcceptLanguageResolver` > `QueryResolver`. `AppException` gains a `translationKey` + `args` field; `AllExceptionsFilter` uses `I18nContext.current()` to resolve the localized string at response time, with English JSON as last-resort fallback. A new `UsersModule` exposes `PATCH /me/language` guarded by `JwtAuthGuard`.

**Tech Stack:** NestJS 11, nestjs-i18n (latest), Prisma 7, class-validator, TypeScript nodenext modules, supertest e2e tests with Jest.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/i18n/en/errors.json` | Create | English source strings (19 keys) |
| `src/i18n/ur/errors.json` | Create | Urdu draft translation |
| `src/i18n/ar/errors.json` | Create | Arabic draft translation |
| `src/i18n/fr/errors.json` | Create | French draft translation |
| `src/i18n/es/errors.json` | Create | Spanish draft translation |
| `src/i18n/hi/errors.json` | Create | Hindi draft translation |
| `src/i18n/pt/errors.json` | Create | Portuguese draft translation |
| `src/i18n/bn/errors.json` | Create | Bengali draft translation |
| `src/i18n/ru/errors.json` | Create | Russian draft translation |
| `src/i18n/zh/errors.json` | Create | Chinese draft translation |
| `src/i18n/STATUS.md` | Create | Translation status manifest |
| `src/common/errors/app-exception.ts` | Modify | Add `translationKey` + `args`, keep `code` |
| `src/common/errors/all-exceptions.filter.ts` | Modify | Resolve via `I18nContext`, fallback to EN |
| `src/i18n/resolvers/user-preference.resolver.ts` | Create | Custom resolver reading `req.user?.preferredLanguage` |
| `src/app.module.ts` | Modify | Register `I18nModule` with 3 resolvers |
| `prisma/schema.prisma` | Modify | Add `preferredLanguage String?` to `User` |
| `src/users/dto/update-language.dto.ts` | Create | DTO with `IsIn` validator for 10 locales |
| `src/users/users.controller.ts` | Create | `PATCH /me/language` endpoint |
| `src/users/users.module.ts` | Create | `UsersModule` wiring controller + PrismaModule |
| `src/llm/llm.service.ts` | Modify | Pass translation keys instead of raw strings |
| `src/auth/auth.service.ts` | Modify | Pass translation keys |
| `src/auth/guards/roles.guard.ts` | Modify | Pass translation key |
| `src/auth/guards/super-admin.guard.ts` | Modify | Pass translation key |
| `src/documents/quota.guard.ts` | Modify | Pass translation keys + args |
| `src/documents/documents.service.ts` | Modify | Pass translation keys |
| `src/jobs/jobs.service.ts` | Modify | Pass translation keys + args |
| `src/billing/billing.service.ts` | Modify | Pass translation key |
| `test/i18n.e2e-spec.ts` | Create | TDD e2e test for localization |

---

## Task 1: Install nestjs-i18n and create English source JSON

**Files:**
- Create: `src/i18n/en/errors.json`

- [ ] **Step 1: Install nestjs-i18n**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api
pnpm add nestjs-i18n
```

Expected: Package added to `node_modules`, `package.json` updated.

- [ ] **Step 2: Verify interpolation syntax**

```bash
cat node_modules/nestjs-i18n/package.json | grep '"version"'
# Also check what ICU syntax the docs use:
grep -r "interpolation\|ICU\|{{\|{ " node_modules/nestjs-i18n/README.md 2>/dev/null | head -20 || true
```

> NOTE: `nestjs-i18n` v10+ uses `{var}` single-brace syntax (not `{{var}}`). The e2e test in Task 8 is the source of truth — if interpolation is wrong, the test will fail with the raw key or un-interpolated string.

- [ ] **Step 3: Create the English source JSON**

Create `src/i18n/en/errors.json`:
```json
{
  "llmNotConfigured": "No LLM provider is configured. Ask the platform admin.",
  "llmProviderUnavailable": "Provider {provider} is not available.",
  "llmGenerationFailed": "Generation failed: {message}",
  "llmUnreadable": "The AI returned an unreadable response. Please try again.",
  "llmIncomplete": "The AI returned an incomplete response. Please try again.",
  "emailInUse": "Email already in use.",
  "invalidCredentials": "Invalid email or password.",
  "invalidRefreshToken": "Invalid refresh token.",
  "accessRevoked": "Access revoked.",
  "roleForbidden": "Your role cannot perform this action.",
  "superAdminOnly": "Super-admin only.",
  "orgNotFound": "Organization not found.",
  "subscriptionInactive": "Your subscription is inactive. Update payment to continue.",
  "quotaExceeded": "You have reached your plan limit of {limit} generations this period.",
  "profileNotFound": "Profile not found.",
  "documentNotFound": "Document not found.",
  "jobNotFound": "Job not found.",
  "duplicateName": "You already have a job named \"{name}\". Names must be unique.",
  "invalidWebhookSignature": "Invalid webhook signature."
}
```

---

## Task 2: Create the 9 draft locale JSON files

**Files:**
- Create: `src/i18n/ur/errors.json`
- Create: `src/i18n/ar/errors.json`
- Create: `src/i18n/fr/errors.json`
- Create: `src/i18n/es/errors.json`
- Create: `src/i18n/hi/errors.json`
- Create: `src/i18n/pt/errors.json`
- Create: `src/i18n/bn/errors.json`
- Create: `src/i18n/ru/errors.json`
- Create: `src/i18n/zh/errors.json`
- Create: `src/i18n/STATUS.md`

- [ ] **Step 1: Create Urdu translation**

Create `src/i18n/ur/errors.json`:
```json
{
  "llmNotConfigured": "کوئی LLM فراہم کنندہ ترتیب نہیں دیا گیا۔ پلیٹ فارم ایڈمن سے رابطہ کریں۔",
  "llmProviderUnavailable": "فراہم کنندہ {provider} دستیاب نہیں ہے۔",
  "llmGenerationFailed": "تخلیق ناکام ہوئی: {message}",
  "llmUnreadable": "AI نے ناقابل پڑھ جواب دیا۔ دوبارہ کوشش کریں۔",
  "llmIncomplete": "AI نے ادھورا جواب دیا۔ دوبارہ کوشش کریں۔",
  "emailInUse": "ای میل پہلے سے استعمال میں ہے۔",
  "invalidCredentials": "غلط ای میل یا پاس ورڈ۔",
  "invalidRefreshToken": "غلط ریفریش ٹوکن۔",
  "accessRevoked": "رسائی منسوخ کر دی گئی۔",
  "roleForbidden": "آپ کا کردار یہ کام نہیں کر سکتا۔",
  "superAdminOnly": "صرف سپر ایڈمن کے لیے۔",
  "orgNotFound": "تنظیم نہیں ملی۔",
  "subscriptionInactive": "آپ کی سبسکرپشن غیر فعال ہے۔ جاری رکھنے کے لیے ادائیگی اپڈیٹ کریں۔",
  "quotaExceeded": "آپ اس مدت میں {limit} تخلیقات کی حد تک پہنچ گئے ہیں۔",
  "profileNotFound": "پروفائل نہیں ملا۔",
  "documentNotFound": "دستاویز نہیں ملی۔",
  "jobNotFound": "کام نہیں ملا۔",
  "duplicateName": "آپ کے پاس پہلے سے \"{name}\" نام کا کام موجود ہے۔ نام منفرد ہونے چاہیں۔",
  "invalidWebhookSignature": "غلط ویب ہک دستخط۔"
}
```

- [ ] **Step 2: Create Arabic translation**

Create `src/i18n/ar/errors.json`:
```json
{
  "llmNotConfigured": "لم يتم تكوين أي موفر LLM. اتصل بمسؤول النظام.",
  "llmProviderUnavailable": "الموفر {provider} غير متاح.",
  "llmGenerationFailed": "فشل الإنشاء: {message}",
  "llmUnreadable": "أعاد الذكاء الاصطناعي استجابة غير قابلة للقراءة. يرجى المحاولة مرة أخرى.",
  "llmIncomplete": "أعاد الذكاء الاصطناعي استجابة غير مكتملة. يرجى المحاولة مرة أخرى.",
  "emailInUse": "البريد الإلكتروني مستخدم بالفعل.",
  "invalidCredentials": "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
  "invalidRefreshToken": "رمز التحديث غير صالح.",
  "accessRevoked": "تم إلغاء الوصول.",
  "roleForbidden": "دورك لا يمكنه تنفيذ هذا الإجراء.",
  "superAdminOnly": "للمسؤول الأعلى فقط.",
  "orgNotFound": "المنظمة غير موجودة.",
  "subscriptionInactive": "اشتراكك غير نشط. قم بتحديث الدفع للمتابعة.",
  "quotaExceeded": "لقد وصلت إلى حد خطتك البالغ {limit} عمليات إنشاء في هذه الفترة.",
  "profileNotFound": "الملف الشخصي غير موجود.",
  "documentNotFound": "المستند غير موجود.",
  "jobNotFound": "الوظيفة غير موجودة.",
  "duplicateName": "لديك بالفعل وظيفة باسم \"{name}\". يجب أن تكون الأسماء فريدة.",
  "invalidWebhookSignature": "توقيع webhook غير صالح."
}
```

- [ ] **Step 3: Create French translation**

Create `src/i18n/fr/errors.json`:
```json
{
  "llmNotConfigured": "Aucun fournisseur LLM n'est configuré. Contactez l'administrateur.",
  "llmProviderUnavailable": "Le fournisseur {provider} n'est pas disponible.",
  "llmGenerationFailed": "Échec de la génération : {message}",
  "llmUnreadable": "L'IA a renvoyé une réponse illisible. Veuillez réessayer.",
  "llmIncomplete": "L'IA a renvoyé une réponse incomplète. Veuillez réessayer.",
  "emailInUse": "L'adresse e-mail est déjà utilisée.",
  "invalidCredentials": "E-mail ou mot de passe invalide.",
  "invalidRefreshToken": "Jeton de rafraîchissement invalide.",
  "accessRevoked": "Accès révoqué.",
  "roleForbidden": "Votre rôle ne peut pas effectuer cette action.",
  "superAdminOnly": "Réservé aux super-administrateurs.",
  "orgNotFound": "Organisation introuvable.",
  "subscriptionInactive": "Votre abonnement est inactif. Mettez à jour le paiement pour continuer.",
  "quotaExceeded": "Vous avez atteint la limite de votre plan de {limit} générations pour cette période.",
  "profileNotFound": "Profil introuvable.",
  "documentNotFound": "Document introuvable.",
  "jobNotFound": "Offre d'emploi introuvable.",
  "duplicateName": "Vous avez déjà une offre d'emploi nommée \"{name}\". Les noms doivent être uniques.",
  "invalidWebhookSignature": "Signature webhook invalide."
}
```

- [ ] **Step 4: Create Spanish translation**

Create `src/i18n/es/errors.json`:
```json
{
  "llmNotConfigured": "No hay ningún proveedor LLM configurado. Contacte al administrador.",
  "llmProviderUnavailable": "El proveedor {provider} no está disponible.",
  "llmGenerationFailed": "Error en la generación: {message}",
  "llmUnreadable": "La IA devolvió una respuesta ilegible. Por favor, inténtelo de nuevo.",
  "llmIncomplete": "La IA devolvió una respuesta incompleta. Por favor, inténtelo de nuevo.",
  "emailInUse": "El correo electrónico ya está en uso.",
  "invalidCredentials": "Correo electrónico o contraseña incorrectos.",
  "invalidRefreshToken": "Token de actualización inválido.",
  "accessRevoked": "Acceso revocado.",
  "roleForbidden": "Su rol no puede realizar esta acción.",
  "superAdminOnly": "Solo para superadministradores.",
  "orgNotFound": "Organización no encontrada.",
  "subscriptionInactive": "Su suscripción está inactiva. Actualice el pago para continuar.",
  "quotaExceeded": "Ha alcanzado el límite de su plan de {limit} generaciones en este período.",
  "profileNotFound": "Perfil no encontrado.",
  "documentNotFound": "Documento no encontrado.",
  "jobNotFound": "Empleo no encontrado.",
  "duplicateName": "Ya tiene un empleo llamado \"{name}\". Los nombres deben ser únicos.",
  "invalidWebhookSignature": "Firma de webhook inválida."
}
```

- [ ] **Step 5: Create Hindi translation**

Create `src/i18n/hi/errors.json`:
```json
{
  "llmNotConfigured": "कोई LLM प्रदाता कॉन्फ़िगर नहीं किया गया है। प्लेटफ़ॉर्म व्यवस्थापक से संपर्क करें।",
  "llmProviderUnavailable": "प्रदाता {provider} उपलब्ध नहीं है।",
  "llmGenerationFailed": "उत्पादन विफल: {message}",
  "llmUnreadable": "AI ने अपठनीय प्रतिक्रिया दी। कृपया पुनः प्रयास करें।",
  "llmIncomplete": "AI ने अधूरी प्रतिक्रिया दी। कृपया पुनः प्रयास करें।",
  "emailInUse": "ईमेल पहले से उपयोग में है।",
  "invalidCredentials": "अमान्य ईमेल या पासवर्ड।",
  "invalidRefreshToken": "अमान्य रिफ्रेश टोकन।",
  "accessRevoked": "एक्सेस रद्द कर दी गई।",
  "roleForbidden": "आपकी भूमिका यह कार्य नहीं कर सकती।",
  "superAdminOnly": "केवल सुपर-एडमिन के लिए।",
  "orgNotFound": "संगठन नहीं मिला।",
  "subscriptionInactive": "आपकी सदस्यता निष्क्रिय है। जारी रखने के लिए भुगतान अपडेट करें।",
  "quotaExceeded": "आपने इस अवधि में {limit} उत्पादन की सीमा पार कर ली है।",
  "profileNotFound": "प्रोफ़ाइल नहीं मिली।",
  "documentNotFound": "दस्तावेज़ नहीं मिला।",
  "jobNotFound": "नौकरी नहीं मिली।",
  "duplicateName": "आपके पास पहले से \"{name}\" नाम की नौकरी है। नाम अद्वितीय होने चाहिए।",
  "invalidWebhookSignature": "अमान्य वेबहुक हस्ताक्षर।"
}
```

- [ ] **Step 6: Create Portuguese translation**

Create `src/i18n/pt/errors.json`:
```json
{
  "llmNotConfigured": "Nenhum provedor LLM está configurado. Contate o administrador.",
  "llmProviderUnavailable": "O provedor {provider} não está disponível.",
  "llmGenerationFailed": "Falha na geração: {message}",
  "llmUnreadable": "A IA retornou uma resposta ilegível. Por favor, tente novamente.",
  "llmIncomplete": "A IA retornou uma resposta incompleta. Por favor, tente novamente.",
  "emailInUse": "E-mail já em uso.",
  "invalidCredentials": "E-mail ou senha inválidos.",
  "invalidRefreshToken": "Token de atualização inválido.",
  "accessRevoked": "Acesso revogado.",
  "roleForbidden": "Seu papel não pode executar esta ação.",
  "superAdminOnly": "Apenas para super-administradores.",
  "orgNotFound": "Organização não encontrada.",
  "subscriptionInactive": "Sua assinatura está inativa. Atualize o pagamento para continuar.",
  "quotaExceeded": "Você atingiu o limite do seu plano de {limit} gerações neste período.",
  "profileNotFound": "Perfil não encontrado.",
  "documentNotFound": "Documento não encontrado.",
  "jobNotFound": "Vaga não encontrada.",
  "duplicateName": "Você já tem uma vaga chamada \"{name}\". Os nomes devem ser únicos.",
  "invalidWebhookSignature": "Assinatura de webhook inválida."
}
```

- [ ] **Step 7: Create Bengali translation**

Create `src/i18n/bn/errors.json`:
```json
{
  "llmNotConfigured": "কোনো LLM প্রদানকারী কনফিগার করা নেই। প্ল্যাটফর্ম অ্যাডমিনের সাথে যোগাযোগ করুন।",
  "llmProviderUnavailable": "প্রদানকারী {provider} উপলব্ধ নেই।",
  "llmGenerationFailed": "উৎপাদন ব্যর্থ: {message}",
  "llmUnreadable": "AI অপঠনযোগ্য প্রতিক্রিয়া ফেরত দিয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।",
  "llmIncomplete": "AI অসম্পূর্ণ প্রতিক্রিয়া ফেরত দিয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।",
  "emailInUse": "ইমেইল ইতিমধ্যে ব্যবহারে আছে।",
  "invalidCredentials": "অবৈধ ইমেইল বা পাসওয়ার্ড।",
  "invalidRefreshToken": "অবৈধ রিফ্রেশ টোকেন।",
  "accessRevoked": "অ্যাক্সেস বাতিল করা হয়েছে।",
  "roleForbidden": "আপনার ভূমিকা এই কাজ করতে পারে না।",
  "superAdminOnly": "শুধুমাত্র সুপার-অ্যাডমিনের জন্য।",
  "orgNotFound": "সংস্থা পাওয়া যায়নি।",
  "subscriptionInactive": "আপনার সাবস্ক্রিপশন নিষ্ক্রিয়। চালিয়ে যেতে পেমেন্ট আপডেট করুন।",
  "quotaExceeded": "আপনি এই সময়কালে {limit} উৎপাদনের সীমায় পৌঁছেছেন।",
  "profileNotFound": "প্রোফাইল পাওয়া যায়নি।",
  "documentNotFound": "দলিল পাওয়া যায়নি।",
  "jobNotFound": "চাকরি পাওয়া যায়নি।",
  "duplicateName": "আপনার কাছে ইতিমধ্যে \"{name}\" নামের একটি চাকরি আছে। নামগুলি অনন্য হতে হবে।",
  "invalidWebhookSignature": "অবৈধ ওয়েবহুক স্বাক্ষর।"
}
```

- [ ] **Step 8: Create Russian translation**

Create `src/i18n/ru/errors.json`:
```json
{
  "llmNotConfigured": "Провайдер LLM не настроен. Обратитесь к администратору платформы.",
  "llmProviderUnavailable": "Провайдер {provider} недоступен.",
  "llmGenerationFailed": "Ошибка генерации: {message}",
  "llmUnreadable": "ИИ вернул нечитаемый ответ. Пожалуйста, попробуйте снова.",
  "llmIncomplete": "ИИ вернул неполный ответ. Пожалуйста, попробуйте снова.",
  "emailInUse": "Этот адрес электронной почты уже используется.",
  "invalidCredentials": "Неверный адрес электронной почты или пароль.",
  "invalidRefreshToken": "Недействительный токен обновления.",
  "accessRevoked": "Доступ отозван.",
  "roleForbidden": "Ваша роль не может выполнить это действие.",
  "superAdminOnly": "Только для супер-администраторов.",
  "orgNotFound": "Организация не найдена.",
  "subscriptionInactive": "Ваша подписка неактивна. Обновите платёж для продолжения.",
  "quotaExceeded": "Вы достигли лимита плана в {limit} генераций за этот период.",
  "profileNotFound": "Профиль не найден.",
  "documentNotFound": "Документ не найден.",
  "jobNotFound": "Вакансия не найдена.",
  "duplicateName": "У вас уже есть вакансия с именем \"{name}\". Имена должны быть уникальными.",
  "invalidWebhookSignature": "Недействительная подпись webhook."
}
```

- [ ] **Step 9: Create Chinese translation**

Create `src/i18n/zh/errors.json`:
```json
{
  "llmNotConfigured": "未配置 LLM 提供商。请联系平台管理员。",
  "llmProviderUnavailable": "提供商 {provider} 不可用。",
  "llmGenerationFailed": "生成失败：{message}",
  "llmUnreadable": "AI 返回了无法读取的响应。请重试。",
  "llmIncomplete": "AI 返回了不完整的响应。请重试。",
  "emailInUse": "电子邮件已被使用。",
  "invalidCredentials": "无效的电子邮件或密码。",
  "invalidRefreshToken": "无效的刷新令牌。",
  "accessRevoked": "访问已被撤销。",
  "roleForbidden": "您的角色无法执行此操作。",
  "superAdminOnly": "仅限超级管理员。",
  "orgNotFound": "组织未找到。",
  "subscriptionInactive": "您的订阅已失效。请更新付款以继续。",
  "quotaExceeded": "您已达到本期计划限制 {limit} 次生成。",
  "profileNotFound": "未找到个人资料。",
  "documentNotFound": "文档未找到。",
  "jobNotFound": "职位未找到。",
  "duplicateName": "您已有名为"{name}"的职位。名称必须唯一。",
  "invalidWebhookSignature": "无效的 webhook 签名。"
}
```

- [ ] **Step 10: Create STATUS.md manifest**

Create `src/i18n/STATUS.md`:
```markdown
# i18n Translation Status

| Locale | Language | Status | Notes |
|--------|----------|--------|-------|
| `en` | English | source / reviewed | Authored source strings — do not machine-translate |
| `ur` | Urdu | draft (machine, needs native review) | **Tier-1** — required review before production |
| `ar` | Arabic | draft (machine, needs native review) | **Tier-1** — required review before production |
| `fr` | French | draft (machine, needs native review) | **Tier-1** — required review before production |
| `es` | Spanish | draft (machine) | |
| `hi` | Hindi | draft (machine) | |
| `pt` | Portuguese | draft (machine) | |
| `bn` | Bengali | draft (machine) | |
| `ru` | Russian | draft (machine) | |
| `zh` | Chinese (Simplified) | draft (machine) | |

## Tier-1 (Priority for native review before production)
`ur`, `ar`, `fr` — highest geographic relevance; block production deployment until reviewed.

## Interpolation syntax
nestjs-i18n uses single-brace `{varName}` for ICU-style interpolation.
```

---

## Task 3: Refactor AppException to carry translation key

**Files:**
- Modify: `src/common/errors/app-exception.ts`

- [ ] **Step 1: Update AppException class**

Replace the entire `src/common/errors/app-exception.ts` with:
```typescript
import { HttpException } from '@nestjs/common';

export type AppErrorCode =
  | 'DUPLICATE_NAME' | 'QUOTA_EXCEEDED' | 'SUBSCRIPTION_INACTIVE'
  | 'LLM_NOT_CONFIGURED' | 'LLM_PROVIDER_ERROR'
  | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION';

export class AppException extends HttpException {
  constructor(
    statusCode: number,
    public code: AppErrorCode,
    public translationKey: string,
    public args?: Record<string, any>,
  ) {
    super({ statusCode, code, translationKey, args }, statusCode);
  }
}
```

> IMPORTANT: The `code` field is the stable API contract — never change existing `AppErrorCode` values. The `translationKey` is the new field; `message` is now resolved at response time by the filter.

---

## Task 4: Update AllExceptionsFilter to resolve i18n messages

**Files:**
- Modify: `src/common/errors/all-exceptions.filter.ts`

- [ ] **Step 1: Replace AllExceptionsFilter**

Replace the entire `src/common/errors/all-exceptions.filter.ts` with:
```typescript
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { I18nContext } from 'nestjs-i18n';
import { AppException } from './app-exception.js';
// English fallback — flat map from "errors.key" → string
import enErrors from '../../i18n/en/errors.json' assert { type: 'json' };

type EnErrors = Record<string, string>;
const EN_FLAT: EnErrors = Object.fromEntries(
  Object.entries(enErrors as EnErrors).map(([k, v]) => [`errors.${k}`, v]),
);

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof AppException) {
      const status = exception.getStatus();
      const i18n = I18nContext.current();
      let message: string | undefined;
      if (i18n) {
        try {
          const translated = i18n.translate(exception.translationKey, { args: exception.args });
          // nestjs-i18n returns the key unchanged when translation is missing
          if (translated && translated !== exception.translationKey) {
            message = translated;
          }
        } catch {
          // i18n not ready in some unit-test contexts — fall through to EN_FLAT
        }
      }
      if (!message) {
        // Fallback: interpolate English source string manually
        let fallback = EN_FLAT[exception.translationKey] ?? exception.translationKey;
        if (exception.args) {
          for (const [k, v] of Object.entries(exception.args)) {
            fallback = fallback.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
          }
        }
        message = fallback;
      }
      return res.status(status).json({ statusCode: status, code: exception.code, message });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse() as any;
      const code = body.code ?? this.defaultCode(status);
      const message = Array.isArray(body.message) ? body.message.join(', ')
        : (body.message ?? exception.message);
      return res.status(status).json({ statusCode: status, code, message });
    }

    return res.status(500).json({ statusCode: 500, code: 'INTERNAL', message: 'Internal error' });
  }

  private defaultCode(status: number) {
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    if (status === 400) return 'VALIDATION';
    return 'ERROR';
  }
}
```

> NOTE on nodenext imports: With `"module": "nodenext"`, relative imports need `.js` extensions even for `.ts` source files. The `assert { type: 'json' }` syntax is required for JSON imports. If the build complains about `assert`, use `with { type: 'json' }` (Node 22+ syntax). If both fail, use `createRequire` or a simple `require()` wrapper.

---

## Task 5: Create UserPreferenceResolver

**Files:**
- Create: `src/i18n/resolvers/user-preference.resolver.ts`

- [ ] **Step 1: Create the custom resolver**

Create `src/i18n/resolvers/user-preference.resolver.ts`:
```typescript
import { Injectable, ExecutionContext } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';

@Injectable()
export class UserPreferenceResolver implements I18nResolver {
  resolve(context: ExecutionContext): string | undefined {
    const req = context.switchToHttp().getRequest();
    return req?.user?.preferredLanguage ?? undefined;
  }
}
```

---

## Task 6: Configure I18nModule in AppModule

**Files:**
- Modify: `src/app.module.ts`

- [ ] **Step 1: Update AppModule**

Replace `src/app.module.ts` with:
```typescript
import { Module } from '@nestjs/common';
import * as path from 'path';
import { I18nModule, AcceptLanguageResolver, QueryResolver } from 'nestjs-i18n';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './health/health.controller.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { CryptoModule } from './common/crypto/crypto.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { AdminModule } from './admin/admin.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { BillingModule } from './billing/billing.module.js';
import { UsersModule } from './users/users.module.js';
import { UserPreferenceResolver } from './i18n/resolvers/user-preference.resolver.js';

@Module({
  imports: [
    I18nModule.forRoot({
      fallbackLanguage: 'en',
      loaderOptions: {
        path: path.join(process.cwd(), 'src', 'i18n'),
        watch: false,
      },
      resolvers: [
        UserPreferenceResolver,
        AcceptLanguageResolver,
        { use: QueryResolver, options: ['lang'] },
      ],
    }),
    PrismaModule,
    CryptoModule,
    AuthModule,
    JobsModule,
    AdminModule,
    DocumentsModule,
    BillingModule,
    UsersModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
```

> CRITICAL loader path note: `process.cwd()` resolves to the project root in both `ts-node` (jest e2e) and `node dist/src/main.js` (production). This avoids the `__dirname` mismatching between source (`src/`) and built (`dist/src/`) paths. After `pnpm build`, you must ensure the `src/i18n` directory is copied into `dist` — see Task 6 Step 2.

- [ ] **Step 2: Ensure i18n files are included in the build**

Check the nest-cli.json and update if needed to copy assets:
```bash
cat /Users/elktech/Desktop/Ali/winprop-api/nest-cli.json
```

If `nest-cli.json` does not have an `assets` field, update it to:
```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
    "assets": [
      { "include": "i18n/**/*", "watchAssets": true }
    ]
  }
}
```

> This causes `nest build` to copy `src/i18n/**/*.json` into `dist/src/i18n/`. Since `loaderOptions.path` uses `process.cwd() + '/src/i18n'`, the source tree is always read from the project root regardless of whether we're in dev or built mode. This is intentional — we read from source in both cases. If this causes issues in a deployed Docker container (where `src/` may not exist), switch to `path.join(__dirname, '..', 'i18n')` and adjust after build testing.

---

## Task 7: Add Prisma migration for preferredLanguage

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add field to User model**

In `prisma/schema.prisma`, update the `User` model from:
```prisma
model User {
  id           String       @id @default(cuid())
  email        String       @unique
  passwordHash String
  name         String
  createdAt    DateTime     @default(now())
  memberships  Membership[]
}
```

to:
```prisma
model User {
  id                String       @id @default(cuid())
  email             String       @unique
  passwordHash      String
  name              String
  preferredLanguage String?
  createdAt         DateTime     @default(now())
  memberships       Membership[]
}
```

- [ ] **Step 2: Run migration**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api && pnpm prisma migrate dev --name user_preferred_language
```

Expected output:
```
Your database is now in sync with your schema.
✔  Generated Prisma Client
```

---

## Task 8: Update JwtStrategy to include preferredLanguage

**Files:**
- Modify: `src/auth/jwt.strategy.ts`

- [ ] **Step 1: Add preferredLanguage to JwtUser and validate**

The JWT payload does NOT contain `preferredLanguage` (it's not in the JWT). Instead, the `UserPreferenceResolver` needs to read it from the database or the request object. Since loading it from DB on every request adds latency, we'll instead store it in the JWT at sign-in time and include it in the `JwtUser` interface.

However, existing JWTs won't have the field — so keep it optional.

Replace `src/auth/jwt.strategy.ts` with:
```typescript
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface JwtUser {
  userId: string;
  orgId: string;
  role: string;
  preferredLanguage?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_SECRET || 'dev-secret',
    });
  }
  async validate(payload: any): Promise<JwtUser> {
    return {
      userId: payload.sub,
      orgId: payload.orgId,
      role: payload.role,
      preferredLanguage: payload.preferredLanguage,
    };
  }
}
```

---

## Task 9: Update PATCH /me/language — Users module

**Files:**
- Create: `src/users/dto/update-language.dto.ts`
- Create: `src/users/users.controller.ts`
- Create: `src/users/users.module.ts`

- [ ] **Step 1: Create DTO**

Create `src/users/dto/update-language.dto.ts`:
```typescript
import { IsIn } from 'class-validator';

export const SUPPORTED_LANGUAGES = ['en', 'ur', 'ar', 'fr', 'es', 'hi', 'pt', 'bn', 'ru', 'zh'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export class UpdateLanguageDto {
  @IsIn(SUPPORTED_LANGUAGES, { message: `language must be one of: ${SUPPORTED_LANGUAGES.join(', ')}` })
  language!: SupportedLanguage;
}
```

- [ ] **Step 2: Create MeController**

Create `src/users/users.controller.ts`:
```typescript
import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.js';
import { JwtUser } from '../auth/jwt.strategy.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateLanguageDto } from './dto/update-language.dto.js';

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private prisma: PrismaService) {}

  @Patch('language')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Set preferred language for the authenticated user' })
  async setLanguage(
    @CurrentUser() user: JwtUser,
    @Body() dto: UpdateLanguageDto,
  ) {
    await this.prisma.user.update({
      where: { id: user.userId },
      data: { preferredLanguage: dto.language },
    });
    return { ok: true, language: dto.language };
  }
}
```

- [ ] **Step 3: Create UsersModule**

Create `src/users/users.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
})
export class UsersModule {}
```

---

## Task 10: Update all AppException throw sites

**Files:**
- Modify: `src/llm/llm.service.ts`
- Modify: `src/auth/auth.service.ts`
- Modify: `src/auth/guards/roles.guard.ts`
- Modify: `src/auth/guards/super-admin.guard.ts`
- Modify: `src/documents/quota.guard.ts`
- Modify: `src/documents/documents.service.ts`
- Modify: `src/jobs/jobs.service.ts`
- Modify: `src/billing/billing.service.ts`

> In all files, the `new AppException(statusCode, code, message)` 3-arg calls become 4-arg `new AppException(statusCode, code, translationKey, args?)` calls. The `code` values NEVER change.

- [ ] **Step 1: Update llm.service.ts**

In `src/llm/llm.service.ts`, make these changes:

Line 22 — from:
```typescript
if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'No LLM provider is configured. Ask the platform admin.');
```
to:
```typescript
if (!cfg) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmNotConfigured');
```

Line 24 — from:
```typescript
if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', `Provider ${cfg.provider} not available.`);
```
to:
```typescript
if (!provider) throw new AppException(503, 'LLM_NOT_CONFIGURED', 'errors.llmProviderUnavailable', { provider: cfg.provider });
```

Lines 30-31 — from:
```typescript
} catch (e: any) {
  throw new AppException(502, 'LLM_PROVIDER_ERROR', `Generation failed: ${e.message}`);
}
```
to:
```typescript
} catch (e: any) {
  throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmGenerationFailed', { message: e.message });
}
```

- [ ] **Step 2: Update auth.service.ts**

In `src/auth/auth.service.ts`:

Line 24 — from:
```typescript
if (existing) throw new AppException(400, 'VALIDATION', 'Email already in use.');
```
to:
```typescript
if (existing) throw new AppException(400, 'VALIDATION', 'errors.emailInUse');
```

Line 41 — from:
```typescript
throw new AppException(401, 'UNAUTHORIZED', 'Invalid email or password.');
```
to:
```typescript
throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidCredentials');
```

Line 54 — from:
```typescript
try { payload = this.jwt.verify(refreshToken); } catch { throw new AppException(401, 'UNAUTHORIZED', 'Invalid refresh token.'); }
```
to:
```typescript
try { payload = this.jwt.verify(refreshToken); } catch { throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken'); }
```

Line 55 — from:
```typescript
if (payload.typ !== 'refresh') throw new AppException(401, 'UNAUTHORIZED', 'Invalid refresh token.');
```
to:
```typescript
if (payload.typ !== 'refresh') throw new AppException(401, 'UNAUTHORIZED', 'errors.invalidRefreshToken');
```

Line 59 — from:
```typescript
if (!membership) throw new AppException(401, 'UNAUTHORIZED', 'Access revoked.');
```
to:
```typescript
if (!membership) throw new AppException(401, 'UNAUTHORIZED', 'errors.accessRevoked');
```

- [ ] **Step 3: Update roles.guard.ts**

In `src/auth/guards/roles.guard.ts`, line 14 — from:
```typescript
if (!user || !required.includes(user.role)) throw new AppException(403, 'FORBIDDEN', 'Your role cannot perform this action.');
```
to:
```typescript
if (!user || !required.includes(user.role)) throw new AppException(403, 'FORBIDDEN', 'errors.roleForbidden');
```

- [ ] **Step 4: Update super-admin.guard.ts**

In `src/auth/guards/super-admin.guard.ts`:

Line 10 — from:
```typescript
if (!email) throw new AppException(403, 'FORBIDDEN', 'Super-admin only.');
```
to:
```typescript
if (!email) throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');
```

Line 12 — from:
```typescript
if (!found) throw new AppException(403, 'FORBIDDEN', 'Super-admin only.');
```
to:
```typescript
if (!found) throw new AppException(403, 'FORBIDDEN', 'errors.superAdminOnly');
```

- [ ] **Step 5: Update quota.guard.ts**

In `src/documents/quota.guard.ts`:

Line 13 — from:
```typescript
if (!org) throw new AppException(404, 'NOT_FOUND', 'Org not found.');
```
to:
```typescript
if (!org) throw new AppException(404, 'NOT_FOUND', 'errors.orgNotFound');
```

Line 16 — from:
```typescript
throw new AppException(402, 'SUBSCRIPTION_INACTIVE', 'Your subscription is inactive. Update payment to continue.');
```
to:
```typescript
throw new AppException(402, 'SUBSCRIPTION_INACTIVE', 'errors.subscriptionInactive');
```

Line 26 — from:
```typescript
if (used >= limit) throw new AppException(429, 'QUOTA_EXCEEDED', `You have reached your plan limit of ${limit} generations this period.`);
```
to:
```typescript
if (used >= limit) throw new AppException(429, 'QUOTA_EXCEEDED', 'errors.quotaExceeded', { limit });
```

- [ ] **Step 6: Update documents.service.ts**

In `src/documents/documents.service.ts`:

Line 15 — from:
```typescript
if (!profile) throw new AppException(404, 'NOT_FOUND', 'Profile not found.');
```
to:
```typescript
if (!profile) throw new AppException(404, 'NOT_FOUND', 'errors.profileNotFound');
```

Line 24 — from:
```typescript
throw new AppException(502, 'LLM_PROVIDER_ERROR', 'The AI returned an unreadable response. Please try again.');
```
to:
```typescript
throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmUnreadable');
```

Line 27 — from:
```typescript
throw new AppException(502, 'LLM_PROVIDER_ERROR', 'The AI returned an incomplete response. Please try again.');
```
to:
```typescript
throw new AppException(502, 'LLM_PROVIDER_ERROR', 'errors.llmIncomplete');
```

Line 48 — from:
```typescript
if (!doc) throw new AppException(404, 'NOT_FOUND', 'Document not found.');
```
to:
```typescript
if (!doc) throw new AppException(404, 'NOT_FOUND', 'errors.documentNotFound');
```

- [ ] **Step 7: Update jobs.service.ts**

In `src/jobs/jobs.service.ts`:

Line 18 — from:
```typescript
if (clash.length) throw new AppException(409, 'DUPLICATE_NAME', `You already have a job named "${title.trim()}". Names must be unique.`);
```
to:
```typescript
if (clash.length) throw new AppException(409, 'DUPLICATE_NAME', 'errors.duplicateName', { name: title.trim() });
```

Lines 22-24 — from:
```typescript
if (e?.code === 'P2002' || /job_org_title_uniq/.test(msg) || e?.meta?.code === '23505')
  throw new AppException(409, 'DUPLICATE_NAME', `You already have a job named "${title.trim()}".`);
```
to:
```typescript
if (e?.code === 'P2002' || /job_org_title_uniq/.test(msg) || e?.meta?.code === '23505')
  throw new AppException(409, 'DUPLICATE_NAME', 'errors.duplicateName', { name: title.trim() });
```

Line 35 — from:
```typescript
if (!job) throw new AppException(404, 'NOT_FOUND', 'Job not found.');
```
to:
```typescript
if (!job) throw new AppException(404, 'NOT_FOUND', 'errors.jobNotFound');
```

- [ ] **Step 8: Update billing.service.ts**

In `src/billing/billing.service.ts`:

Line 44 — from:
```typescript
throw new AppException(400, 'VALIDATION', 'Invalid webhook signature.');
```
to:
```typescript
throw new AppException(400, 'VALIDATION', 'errors.invalidWebhookSignature');
```

---

## Task 11: Write failing e2e test first (TDD red phase)

**Files:**
- Create: `test/i18n.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

Create `test/i18n.e2e-spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

const EN_DUPLICATE = 'You already have a job named "Acme Corp". Names must be unique.';
const EN_INVALID_CREDS = 'Invalid email or password.';

async function signup(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'pw1234567', name: 'Test', agencyName: 'TestAgency', profession: 'developer' });
  return res.body.accessToken as string;
}

describe('i18n error localization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE',
    );
    token = await signup(app, 'i18n@x.com');
    // Create the first job so duplicate can be triggered
    await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Acme Corp' });
  });

  afterAll(async () => { await app.close(); });

  it('DUPLICATE_NAME en: returns English message', async () => {
    const res = await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'en')
      .send({ title: 'Acme Corp' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NAME');
    expect(res.body.message).toBe(EN_DUPLICATE);
  });

  it('DUPLICATE_NAME ur: returns non-empty Urdu message different from English', async () => {
    const res = await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'ur')
      .send({ title: 'Acme Corp' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NAME');
    expect(res.body.message).toBeTruthy();
    expect(res.body.message).not.toBe(EN_DUPLICATE);
  });

  it('DUPLICATE_NAME xx (unsupported locale): falls back to English message', async () => {
    const res = await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'xx')
      .send({ title: 'Acme Corp' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NAME');
    expect(res.body.message).toBe(EN_DUPLICATE);
  });

  it('UNAUTHORIZED fr: bad login returns French message different from English', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Accept-Language', 'fr')
      .send({ email: 'i18n@x.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body.message).toBeTruthy();
    expect(res.body.message).not.toBe(EN_INVALID_CREDS);
  });
});
```

- [ ] **Step 2: Run test — confirm it FAILS (red phase)**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api && pnpm test:e2e -- --testPathPattern=i18n 2>&1 | tail -30
```

Expected: Test fails — either because `AppModule` doesn't have `I18nModule` yet (from Task 6), or `AllExceptionsFilter` doesn't call `I18nContext` yet (from Task 4). If Tasks 3–10 have been done, the test will fail because `AppModule` change + `AllExceptionsFilter` change may not be committed yet. Confirm at least one of the 4 test cases fails.

---

## Task 12: Wire everything, run green

- [ ] **Step 1: Verify all tasks 1–10 are complete**

Run a quick sanity check:
```bash
cd /Users/elktech/Desktop/Ali/winprop-api && grep -r "translationKey\|errors\." src/common/errors/app-exception.ts src/llm/llm.service.ts src/auth/auth.service.ts | head -20
```

Expected: shows `translationKey` in `app-exception.ts` and `errors.llmNotConfigured` etc. in the services.

- [ ] **Step 2: Run ALL e2e tests**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api && pnpm test:e2e 2>&1 | tail -40
```

Expected:
```
Test Suites: N passed, N total
Tests:       N passed (at least 30), N total
```

All existing 26 tests should remain green (they assert `code` not `message`). The new 4 i18n tests should pass.

- [ ] **Step 3: Run build**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api && pnpm build 2>&1 | tail -20
```

Expected: `Successfully compiled project` or similar with no errors.

- [ ] **Step 4: If loader path fails in build (dist), apply fix**

If tests pass in dev but fail after build, switch loader path in `app.module.ts` from `process.cwd() + /src/i18n` approach to an approach that reads from dist:
```typescript
// In app.module.ts, replace the loaderOptions.path with:
loaderOptions: {
  path: path.resolve(
    process.env.NODE_ENV === 'production'
      ? path.join(__dirname, '..', 'i18n')   // dist/src/i18n → dist/i18n via ../
      : path.join(process.cwd(), 'src', 'i18n')  // src/i18n for dev/test
  ),
  watch: false,
},
```
And ensure `nest-cli.json` copies `i18n/**/*` as assets so they appear at `dist/src/i18n/`.

---

## Task 13: Regenerate OpenAPI spec and commit

**Files:**
- Run: `pnpm openapi`

- [ ] **Step 1: Regenerate the OpenAPI spec**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api && pnpm openapi
```

Expected: `openapi.json` is updated; the `PATCH /me/language` route should appear in the spec.

Verify:
```bash
grep -A 5 '"\/me\/language"' /Users/elktech/Desktop/Ali/winprop-api/openapi.json | head -10
```

- [ ] **Step 2: Final status check**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api && pnpm test:e2e 2>&1 | grep -E "Tests:|Test Suites:|FAIL|PASS"
```

- [ ] **Step 3: Commit**

```bash
cd /Users/elktech/Desktop/Ali/winprop-api && git add -A && git commit -m "feat(i18n): backend nestjs-i18n — localized error envelope, preferredLanguage, PATCH /me/language"
```

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Task |
|-------------|------|
| Install nestjs-i18n | Task 1 Step 1 |
| 10 locale JSON files (en + 9 drafts) | Tasks 1–2 |
| STATUS.md manifest with Tier-1 | Task 2 Step 10 |
| `I18nModule` in AppModule, fallbackLanguage=en | Task 6 |
| Loader path resolves in both ts-node/jest AND dist | Task 6 Step 2 + Task 12 Step 4 |
| Resolvers in correct precedence order | Task 6 Step 1 |
| `UserPreferenceResolver` reads `req.user?.preferredLanguage` | Task 5 |
| `AppException` carries `translationKey` + `args`, keeps `code` | Task 3 |
| `AllExceptionsFilter` resolves via `I18nContext.current()` | Task 4 |
| EN fallback in filter (never emit raw key) | Task 4 Step 1 |
| Non-AppException behavior unchanged | Task 4 Step 1 |
| `User.preferredLanguage String?` added | Task 7 |
| Prisma migration run | Task 7 Step 2 |
| All 19 error throw sites updated | Task 10 |
| `PATCH /me/language` endpoint guarded by JwtAuthGuard | Task 9 |
| Body validated as one of 10 codes | Task 9 Step 1 |
| Returns `{ ok: true, language }` | Task 9 Step 2 |
| e2e test: en=EN string, ur≠EN string, xx=EN fallback | Task 11 |
| e2e test: fr bad-login message ≠ EN | Task 11 |
| TDD red phase first | Task 11 Step 2 |
| All existing 26 tests remain green | Task 12 Step 2 |
| `pnpm build` passes | Task 12 Step 3 |
| OpenAPI spec regenerated | Task 13 Step 1 |
| Git commit | Task 13 Step 3 |

### Type Consistency Check
- `AppException(statusCode, code, translationKey, args?)` — 4-arg constructor used consistently in Task 10
- `JwtUser.preferredLanguage?: string` — used by `UserPreferenceResolver` in Task 5
- `SUPPORTED_LANGUAGES` exported from DTO, used in `@IsIn()` — consistent
- `EN_FLAT` keyed as `"errors.key"` matching the `translationKey` format `"errors.llmNotConfigured"` — consistent

### Potential Issues
1. **nodenext JSON imports**: `import enErrors from '../../i18n/en/errors.json' assert { type: 'json' }` may require `"resolveJsonModule": true` in `tsconfig.json`. If not set, add it. Alternatively, use `createRequire` for the fallback map.
2. **nestjs-i18n interpolation syntax**: The spec says `{var}` single-brace. If the installed version differs, the e2e Urdu test will catch it — the Urdu string will contain a literal `{name}` rather than the interpolated value, causing it to equal the EN string after interpolation fails. Fix by checking the installed version's docs.
3. **I18nContext availability in tests**: Some tests build with `new AllExceptionsFilter()` directly (no args). The updated filter has no constructor args so this is fine. `I18nContext.current()` will return `undefined` in those unit tests, triggering the EN fallback — which is the documented behavior.

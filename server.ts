import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { completePedagogicalData } from './src/utils/pedagogicalLogic';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const isProduction = process.env.NODE_ENV === 'production';

app.use(express.json({ limit: '10mb' }));

// Shared Gemini client (User-Agent header required by telemetry rules)
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

/**
 * Health check endpoint
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    hasApiKey: Boolean(apiKey),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Generate pedagogical document via Gemini API with Algerian Competency-Based Approach
 */
app.post('/api/generate-document', async (req: Request, res: Response) => {
  try {
    const {
      lessonTitle,
      specialty,
      moduleAxis,
      subjectScale,
      lessonNumber,
      teacherName,
      allocatedTime,
      ministry,
      documentType,
      additionalNotes,
      useHighThinking,
      lessonStagesType,
      customStages,
      selectedModel,
    } = req.body;

    if (!lessonTitle) {
      res.status(400).json({
        error: 'يرجى تقديم عنوان الدرس لتوليد الوثيقة البيداغوجية.',
      });
      return;
    }

    // If no API key is available in runtime, gracefully use local pedagogical generator
    if (!apiKey) {
      console.warn('GEMINI_API_KEY is not set. Generating document using Algerian APC internal engine.');
      const localGenerated = completePedagogicalData({
        lessonTitle,
        specialty: specialty || 'الاختصاص التقني',
        moduleAxis: moduleAxis || 'المحور العام للمقياس',
        subjectScale: subjectScale || 'المقياس التعليمي',
        lessonNumber: lessonNumber || '01',
        teacherName: teacherName || 'الأستاذ: ...',
        allocatedTime: allocatedTime || '02',
        ministry: ministry || 'formation_professionnelle',
        documentType: documentType || 'fiche_pedagogique',
      });
      res.json({ success: true, data: localGenerated, isOfflineFallback: true });
      return;
    }

    const systemInstruction = `
أنت مفتش تربوي ومكون رسمي في منظومة التعليم والتكوين المهني والتربية الوطنية الجزائرية خبير في المقاربة بالكفاءات (APC).
مهمتك: توليد وثيقة بيداغوجية متكاملة وسيرورة درس احترافية تملأ كل حقول القالبين الوزاريين المعتمدين:
1. البطاقة البيداغوجية (الأستاذ، الاختصاص، المحور، المقياس، رقم الدرس، عنوان الدرس، الغرض البيداغوجي وفق صيغة الكفاءة، الوقت المقرر، المعدات والمواد والأدوات، المساعدات البيداغوجية، وخطة الدرس من 4 عناصر I إلى IV).
2. بطاقة السيرورة البيداغوجية (جدول مراحل الدرس مع أسئلة وأجوبة الأستاذ والمتربص):
   - المقدمة: تذكير (س: ...؟ / ج: ...)
   - خلق مركز الاهتمام (س: ...؟ / ج: ...)
   - استخراج عنوان الدرس والغرض البيداغوجي وخطة الدرس
   - محطات وعناصر الدرس (I, II, III...):
     * الوضع في صعوبة (س: ...؟ / ج: ...)
     * تقديم المعلومات
     * التقويم الجزئي (س: ...؟ / ج: ...)
   - التقويم الشامل: تلخيص شامل
   - الملاحظات التربوية.

يجب أن تكون الأسئلة محفزة، والصياغة سليمة ودقيقة، والمعدات متطابقة مع الاختصاص والموضوع.
أخرج النتيجة بتنسيق JSON صالح ومحكم.
`;

    const stagesInstruction = customStages 
      ? `مراحل الدرس المحددة من المستخدم: "${customStages}"`
      : lessonStagesType === 'workshop_practical'
      ? 'نمط المراحل: درس تطبيقي ورشة عمل (I. إشكالية الانطلاق • II. دراسة المخطط وتجهيز العتاد • III. التنفيذ والتركيب العملي • IV. فحص التشغيل والتقويم)'
      : lessonStagesType === 'conceptual_theory'
      ? 'نمط المراحل: درس نظري مفاهيمي (I. تمهيد واستثارة • II. استكشاف وبناء المفاهيم • III. تطبيقات وأمثلة استنتاجية • IV. حوصلة وتقويم تحصيلي)'
      : 'نمط المراحل: المحطات الأربع النموذجية للمقاربة بالكفاءات الجزائرية (I. وضعية الانطلاق • II. بناء التعلمات • III. إعادة الاستثمار والتطبيق • IV. التقويم والحصيلة)';

    const promptText = `
قم بإعداد وثيقة بيداغوجية وسيرورة درس احترافية ومفصلة بالمعطيات التالية:
- عنوان الدرس: "${lessonTitle}"
- الاختصاص: "${specialty || 'تقني'}"
- المحور: "${moduleAxis || 'المحور المقرر'}"
- المقياس: "${subjectScale || 'المقياس المقرر'}"
- رقم الدرس: "${lessonNumber || '01'}"
- الأستاذ: "${teacherName || 'الأستاذ'}"
- الوقت المقرر: "${allocatedTime || '02'} سـا"
- نمط المراحل والتنظيم: ${stagesInstruction}
- ملاحظات إضافية: "${additionalNotes || 'لا يوجد'}"

أرجع كائن JSON بالحقول التالية بالضبط:
{
  "specialty": "${specialty || 'الاختصاص المناسب للدرس'}",
  "moduleAxis": "${moduleAxis || 'المحور البيداغوجي الملائم'}",
  "subjectScale": "${subjectScale || 'المقياس المناسب'}",
  "pedagogicalObjective": "الغرض البيداغوجي بصيغة كفاءة دقيقة: أن يكون المتربص في نهاية الحصة قادراً على [فعل سلوكي إجرائي] [المفهوم/المهمة] انطلاقاً من [شروط الإنجاز] وبدقة تصل إلى [معايير النجاح].",
  "extraTeacherEquipment1": "أجهزة إضافية خاصة بالأستاذ ملائمة لموضوع الدرس",
  "extraTeacherEquipment2": "مطبوعات ووسائل توضيحية للأستاذ",
  "schoolSupplies": "الأدوات المدرسية للمتربص",
  "extraStudentEquipment1": "عتاد وتجهيزات المتربص في الورشة أو المخبر خاصة بهذا الدرس",
  "extraStudentEquipment2": "مستلزمات تطبيقية ومستهلكات للمتربص",
  "pedagogicalAids": "المساعدات البيداغوجية المناسبة (عروض، مجسمات، فيديو، نصوص وسندات)",
  "planItem1": "I. وضعية الانطلاق والمشكلة المنطلق: ...",
  "planItem2": "II. بناء التعلمات: ...",
  "planItem3": "III. إعادة الاستثمار والتطبيق: ...",
  "planItem4": "IV. التقويم والحصيلة: ...",
  "deroulementProcess": {
    "reminderQuestion": "سؤال تذكير بمكتسبات سابقة ذات صلة وثيقة بهذا الدرس؟",
    "reminderAnswer": "جواب نموذجي للمتربص",
    "interestHookQuestion": "سؤال إشكالي واقعي يثير الفضول وخلق مركز الاهتمام؟",
    "interestHookAnswer": "جواب وتصور أولي للمتربصين",
    "titleExtraction": "${lessonTitle}",
    "notifyObjective": true,
    "presentPlan": true,
    "elements": [
      {
        "id": "e1",
        "stationNumber": "I",
        "elementTitle": "العنصر الأول في الدرس (تفكيك المفاهيم والقواعد)",
        "difficultyQuestion": "سؤال وضع في صعوبة: إشكالية جزئية تجعل المتربص يشعر بالحاجة إلى المفهوم؟",
        "difficultyAnswer": "تحليل واستنتاج المتربص",
        "presentationContent": "تقديم المعلومات والشرح التقني المركز مع تدوين القواعد الأساسية",
        "supportCourseRef": "01",
        "partialEvalQuestion": "سؤال تقويم جزئي لقياس الفهم الفوري؟",
        "partialEvalAnswer": "إجابة المتربص وتطبيقه المباشر"
      },
      {
        "id": "e2",
        "stationNumber": "II",
        "elementTitle": "العنصر الثاني في الدرس (التطبيق والتنفيذ العملي)",
        "difficultyQuestion": "سؤال وضع في صعوبة حول الإجراءات العملية الدقيقة؟",
        "difficultyAnswer": "اقتراح المتربص للخطوات الميدانية",
        "presentationContent": "توضيح مراحل التنفيذ العملي ومراقبة إنجاز المتربصين",
        "supportCourseRef": "02",
        "partialEvalQuestion": "سؤال تقويم جزئي تطبيقي لقياس التحكم المهاري؟",
        "partialEvalAnswer": "تنفيذ سليم وفق معايير الإتقان"
      }
    ],
    "comprehensiveEval": "تلخيص شامل وخلاصة ختامية للدرس مع التحقق من بلوغ مؤشرات الكفاءة 100%",
    "observations": "ملاحظات وتوجيهات الأستاذ لترسيخ الكفاءة وتوجيه العمل المستقل"
  }
}
`;

    let generatedText = '';
    
    // Resilient multi-tier model cascade
    let usedModel = 'gemini-3.8-flash';
    const modelsToTry = useHighThinking
      ? ['gemini-4-argon', 'gemini-3.8-flash', 'gemini-3.1-flash-lite']
      : ['gemini-3.8-flash', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

    for (const modelCandidate of modelsToTry) {
      try {
        console.log(`Attempting generation with ${modelCandidate}...`);
        const config: any = {
          systemInstruction,
          responseMimeType: 'application/json',
        };

        if (useHighThinking && modelCandidate === 'gemini-4-argon') {
          config.thinkingConfig = {
            thinkingLevel: ThinkingLevel.HIGH,
          };
        }

        const response = await ai.models.generateContent({
          model: modelCandidate,
          contents: promptText,
          config,
        });

        if (response.text) {
          generatedText = response.text;
          usedModel = modelCandidate;
          console.log(`Successfully generated document using ${modelCandidate}`);
          break;
        }
      } catch (err: any) {
        console.warn(`Model ${modelCandidate} failed:`, err?.message || err);
      }
    }

    if (!generatedText) {
      throw new Error('لم يتم استلام نص من نماذج الذكاء الاصطناعي.');
    }

    // Clean JSON if needed
    let cleanedJson = generatedText.trim();
    if (cleanedJson.startsWith('```json')) {
      cleanedJson = cleanedJson.replace(/^```json/, '').replace(/```$/, '').trim();
    } else if (cleanedJson.startsWith('```')) {
      cleanedJson = cleanedJson.replace(/^```/, '').replace(/```$/, '').trim();
    }

    const parsedData = JSON.parse(cleanedJson);

    // Merge with user metadata
    const completeDoc = completePedagogicalData({
      ...req.body,
      ...parsedData,
    });

    res.json({
      success: true,
      data: completeDoc,
      usedModel,
    });
  } catch (error: any) {
    console.error('Error generating document:', error);
    // Provide a helpful fallback rather than a hard crash
    const localGenerated = completePedagogicalData(req.body);
    res.json({
      success: true,
      data: localGenerated,
      usedModel: 'محرك المقاربة بالكفاءات المحلي (APC Fallback)',
      warning: 'تم توليد الوثيقة بالاعتماد على المحرك التربوي المدمج لضمان استمرارية الخدمة.',
    });
  }
});

/**
 * Setup Vite or Static File Serving
 */
async function startServer() {
  if (!isProduction) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Educational platform running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

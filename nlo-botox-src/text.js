/* ================= Patient-facing text (English / Spanish) =================
   {p} in a title is replaced with the product chosen in the app. */
var PTXT = {
  en: {
    common: { patient: 'Patient', dob: 'Date of birth', date: 'Date', chart: 'Chart #', yes: 'Yes', no: 'No', initials: 'Initials' },
    consent: {
      title: 'Informed Consent for Botulinum Toxin Treatment',
      sub: '{p}, a botulinum toxin type A',
      areasLabel: 'Area(s) to be treated',
      areas: {
        glabella: 'Frown lines between the brows (glabella)',
        forehead: 'Forehead lines',
        crows: 'Crow’s feet (lines beside the eyes)',
        gs: 'Gummy smile (too much gum showing when smiling)',
        brux: 'Jaw clenching or grinding, jaw muscle pain (masseter, temporalis)',
        contour: 'Enlarged jaw muscle (masseter)',
        chin: 'Chin dimpling or strain (mentalis)',
        corners: 'Downturned mouth corners (depressor anguli oris)',
        lips: 'Lip lines or lip flip',
        other: 'Other: ______________________________'
      },
      approval: {
        xeomin: 'Xeomin is FDA-approved in adults for frown lines between the brows, forehead lines and crow’s feet.',
        botox: 'BOTOX Cosmetic is FDA-approved in adults for frown lines between the brows, forehead lines, crow’s feet and neck (platysma) bands.',
        jeuveau: 'Jeuveau is FDA-approved in adults for frown lines between the brows.',
        dysport: 'Dysport is FDA-approved for frown lines between the brows in adults under 65.'
      },
      offLabel: 'Treating any other area checked above, including the jaw muscles, a gummy smile, the chin, the mouth corners and the lips, is “off-label,” meaning that use is not listed on the product label. Off-label use is legal and common when, in the doctor’s judgment, it is appropriate for the patient.',
      minorsOff: 'For patients under 18, every use on this form is off-label: none of these products is approved for these uses in anyone under 18.',
      sections: [
        { h: 'What the treatment is', p: ['Botulinum toxin type A is a purified protein that temporarily relaxes the muscles it is injected into. Dr. Akhavan uses very small doses, given with a fine needle, to reduce the muscle activity behind the condition checked above.'] },
        { h: 'Approved and “off-label” use', approval: true },
        { h: 'What to expect', list: [
          'The effect begins in 1–7 days and builds over about 2 weeks. Clenching eases over 1–4 weeks. A change in jaw shape begins at 4–6 weeks and is greatest at about 3 months.',
          'Results usually last about 3–4 months, sometimes longer for the jaw muscles. Repeat treatment is needed to keep the effect.',
          'Results vary. A small touch-up may be recommended at the 2-week visit.'
        ] },
        { h: 'Possible risks and side effects', list: [
          '<b>Common and short-lived:</b> pain, redness, swelling or bruising where the needle went in; headache; tenderness.',
          '<b>Less common:</b> a drooping eyelid or eyebrow, or dry eyes (upper face); an uneven smile or lip movement; drooping of the lip or a mouth corner; trouble puckering, whistling, drinking through a straw or saying some sounds; tired jaw muscles when chewing tough food; a muscle bulge when clenching; infection.',
          '<b>Rare but serious:</b> the effect can spread beyond the treated area, hours to weeks later, causing trouble swallowing, speaking or breathing, general weakness, double or blurred vision, drooping eyelids, hoarseness or loss of bladder control. This needs emergency care right away. Allergic reactions (rash, itching, wheezing, swelling, dizziness) can also happen.',
          'Over time some people make antibodies that make the treatment work less well.',
          'Unwanted effects are temporary and usually fade over weeks to a few months. No medicine reverses the effect.'
        ] },
        { h: 'Alternatives', p: ['Alternatives include no treatment; skin care, fillers or skin resurfacing for facial lines; a night guard, physical therapy or medication for clenching and jaw pain; and, for a gummy smile, orthodontic tooth movement, gum or lip surgery, or jaw surgery. These have been explained to me.'] },
        { h: 'My responsibilities', list: [
          'I have told the doctor about my medical history, medicines and supplements, allergies, and any botulinum toxin treatment in the last 4 months.',
          'I am not pregnant or breastfeeding (if applicable), and I do not have a nerve or muscle disease such as myasthenia gravis, Lambert-Eaton syndrome or ALS.',
          'I will follow the aftercare instructions and come to the 2-week follow-up visit.'
        ] }
      ],
      photos: 'I agree to clinical photographs before and after treatment for my record.',
      photosEdu: 'I agree that my photographs, with my identity hidden, may be used for education or marketing.',
      acknowledge: 'I have read this form or had it read to me. I have had the chance to ask questions, and all of my questions have been answered. I consent to treatment with botulinum toxin by Dr. Akhavan.',
      minor: 'If the patient is under 18, a parent or legal guardian must sign.',
      sigPatient: 'Patient or parent/guardian signature & date',
      sigName: 'Printed name & relationship',
      sigWitness: 'Witness',
      sigDoctor: 'Orthodontist (Dr. Akhavan)'
    },
    screening: {
      title: 'Health Screening for Botulinum Toxin Treatment',
      sub: 'Please complete before every treatment',
      intro: 'Please answer every question. Your answers help us decide whether treatment is safe for you today.',
      q: [
        'Are you pregnant, trying to become pregnant, or breastfeeding?',
        'Do you have a nerve or muscle condition (for example myasthenia gravis, Lambert-Eaton syndrome, ALS, multiple sclerosis or Bell’s palsy)?',
        'Have you had trouble swallowing, breathing problems (such as asthma or COPD) or a weak voice?',
        'Do you have heart disease, or have you had a heart attack or an irregular heartbeat?',
        'Have you had a reaction to Botox, Dysport, Xeomin, Jeuveau, Daxxify or any other botulinum toxin?',
        'Are you allergic to cow’s milk protein or to human albumin?',
        'Have you had botulinum toxin anywhere in your body (cosmetic or medical) in the last 4 months? If yes: where, when and which product?',
        'Do you take blood thinners, aspirin, ibuprofen or naproxen, fish oil, vitamin E or ginkgo?',
        'Do you take muscle relaxants, or antibiotics given by injection or IV (for example gentamicin)?',
        'Do you take an allergy or cold medicine, or a sleep medicine?',
        'Do you have a bleeding or clotting disorder, or do you bruise easily?',
        'Do you have an infection, cold sore, rash or open sore near the area to be treated?',
        'Have you had facial surgery, fillers or nerve problems in your face?',
        'Do you have drooping eyelids or brows, or dry eyes?',
        'Do you play a wind instrument or sing, or rely on precise lip movement for work?',
        'Do you have an important event, photos or travel in the next 2 weeks?',
        'Have you had a side effect, or a result you did not like, from a previous treatment?'
      ],
      meds: 'Medicines and supplements you take',
      allergies: 'Allergies',
      details: 'Details for any “Yes” answer',
      confirm: 'I confirm that this information is complete and correct.',
      sigPatient: 'Patient or parent/guardian signature & date',
      sigReviewed: 'Reviewed by (doctor) & date'
    },
    aftercare: {
      title: 'Before and After Your {p} Treatment',
      sub: 'Botulinum toxin care instructions',
      before: 'Before your visit',
      beforeList: [
        'If your physician agrees, avoid aspirin, ibuprofen, naproxen, fish oil, vitamin E and ginkgo for 3–7 days before treatment to lower the chance of bruising. Do not stop medicines your physician prescribed (such as blood thinners or daily aspirin) without asking them first.',
        'Avoid alcohol for 24 hours before treatment.',
        'Tell us if you are pregnant or breastfeeding, feel sick, or have started a new medicine.'
      ],
      after: 'After treatment: the first day',
      afterList: [
        'Do not rub, massage or press on the treated areas for 24 hours.',
        'Stay upright (do not lie down) for 4 hours.',
        'Skip hard exercise, hot tubs, saunas and facials for 24 hours.',
        'A cold pack for 10 minutes at a time helps swelling or bruising. Hold it gently, without pressing.',
        'You can eat, talk and go back to school or work right away.',
        'For a headache, acetaminophen (Tylenol) is fine unless you have been told not to take it.'
      ],
      expect: 'What to expect',
      expectList: [
        'The effect starts in 1–7 days and is complete at about 2 weeks. Jaw-shape changes begin at 4–6 weeks and are greatest at about 3 months.',
        'Jaw muscles: clenching eases over 1–4 weeks. Tough or chewy foods may tire your jaw for a few weeks; cut food into smaller pieces.',
        'Lips: drinking through a straw, whistling and some sounds may feel different for a few weeks.',
        'Forehead: a heavy or tight feeling for the first week or two is common.',
        'Results usually last 3–4 months, often longer in the jaw muscles.'
      ],
      follow: 'Your follow-up visit',
      followTxt: 'Please come back in 2 weeks so the doctor can check your result:',
      call: 'Call the office if',
      callList: [
        'bruising or swelling gets worse after 2 days;',
        'one eyelid or eyebrow droops near a treated area and you otherwise feel well;',
        'you have double or blurred vision: call right away, and do not drive;',
        'you see signs of infection: spreading redness, warmth, pus or fever;',
        'the result looks uneven and bothers you (it is best judged at the 2-week visit).'
      ],
      emergTitle: 'Emergency: call 911 or go to the emergency room right away',
      emergTxt: 'if at any time in the hours to weeks after treatment you have trouble swallowing, speaking or breathing; weakness spreading beyond the treated area; drooping eyelids or double or blurred vision together with any of these; hoarseness or loss of voice; loss of bladder control; or signs of an allergic reaction (hives, swelling of the face, lips or tongue, wheezing). Do not drive or use machinery if your vision or strength is affected.',
      office: 'Next Level Orthodontics: (352) 332-7466'
    }
  },
  es: {
    common: { patient: 'Paciente', dob: 'Fecha de nacimiento', date: 'Fecha', chart: 'N.º de expediente', yes: 'Sí', no: 'No', initials: 'Iniciales' },
    consent: {
      title: 'Consentimiento informado para el tratamiento con toxina botulínica',
      sub: '{p}, una toxina botulínica tipo A',
      areasLabel: 'Área(s) a tratar',
      areas: {
        glabella: 'Líneas del entrecejo (glabela)',
        forehead: 'Líneas de la frente',
        crows: 'Patas de gallo (líneas al lado de los ojos)',
        gs: 'Sonrisa gingival (se ve demasiada encía al sonreír)',
        brux: 'Apretar o rechinar los dientes, dolor de los músculos de la mandíbula (masetero, temporal)',
        contour: 'Músculo de la mandíbula agrandado (masetero)',
        chin: 'Mentón con hoyuelos o tensión (músculo mentoniano)',
        corners: 'Comisuras de la boca caídas (depresor del ángulo de la boca)',
        lips: 'Líneas de los labios o “lip flip”',
        other: 'Otro: ______________________________'
      },
      approval: {
        xeomin: 'La FDA ha aprobado Xeomin en adultos para las líneas del entrecejo, las líneas de la frente y las patas de gallo.',
        botox: 'La FDA ha aprobado BOTOX Cosmetic en adultos para las líneas del entrecejo, las líneas de la frente, las patas de gallo y las bandas del cuello (platisma).',
        jeuveau: 'La FDA ha aprobado Jeuveau en adultos para las líneas del entrecejo.',
        dysport: 'La FDA ha aprobado Dysport para las líneas del entrecejo en adultos menores de 65 años.'
      },
      offLabel: 'El tratamiento de cualquier otra área marcada arriba, incluidos los músculos de la mandíbula, la sonrisa gingival, el mentón, las comisuras de la boca y los labios, es “fuera de indicación” (off-label), es decir, ese uso no aparece en la etiqueta del producto. El uso fuera de indicación es legal y común cuando, a juicio del doctor, es apropiado para el paciente.',
      minorsOff: 'En pacientes menores de 18 años, todo uso en este formulario es fuera de indicación: ninguno de estos productos está aprobado para estos usos en menores de 18 años.',
      sections: [
        { h: 'Qué es el tratamiento', p: ['La toxina botulínica tipo A es una proteína purificada que relaja temporalmente los músculos donde se inyecta. El Dr. Akhavan usa dosis muy pequeñas, aplicadas con una aguja fina, para reducir la actividad muscular que causa la condición marcada arriba.'] },
        { h: 'Uso aprobado y uso “fuera de indicación”', approval: true },
        { h: 'Qué esperar', list: [
          'El efecto comienza en 1 a 7 días y aumenta durante unas 2 semanas. El hábito de apretar los dientes disminuye en 1 a 4 semanas. El cambio en la forma de la mandíbula empieza a las 4 a 6 semanas y es mayor a los 3 meses aproximadamente.',
          'Los resultados suelen durar unos 3 a 4 meses, a veces más en los músculos de la mandíbula. Se necesitan tratamientos repetidos para mantener el efecto.',
          'Los resultados varían. En la cita de las 2 semanas se puede recomendar un pequeño retoque.'
        ] },
        { h: 'Posibles riesgos y efectos secundarios', list: [
          '<b>Comunes y pasajeros:</b> dolor, enrojecimiento, hinchazón o moretones donde entró la aguja; dolor de cabeza; sensibilidad.',
          '<b>Menos comunes:</b> párpado o ceja caídos, u ojos secos (parte superior de la cara); sonrisa o movimiento de los labios desigual; caída del labio o de una comisura de la boca; dificultad para fruncir los labios, silbar, beber con popote (pajilla) o pronunciar algunos sonidos; cansancio de los músculos de la mandíbula al masticar alimentos duros; un abultamiento del músculo al apretar; infección.',
          '<b>Raros pero graves:</b> el efecto puede extenderse más allá del área tratada, de horas a semanas después, y causar dificultad para tragar, hablar o respirar, debilidad general, visión doble o borrosa, párpados caídos, ronquera o pérdida del control de la vejiga. Esto requiere atención de emergencia de inmediato. También pueden ocurrir reacciones alérgicas (sarpullido, picazón, silbido al respirar, hinchazón, mareo).',
          'Con el tiempo, algunas personas producen anticuerpos que hacen que el tratamiento funcione menos.',
          'Los efectos no deseados son temporales y suelen desaparecer en semanas o en pocos meses. Ningún medicamento revierte el efecto.'
        ] },
        { h: 'Alternativas', p: ['Las alternativas incluyen no hacer el tratamiento; cuidado de la piel, rellenos o tratamientos de la piel para las líneas de expresión; un protector nocturno, fisioterapia o medicamentos para el hábito de apretar o rechinar los dientes y el dolor de mandíbula; y, para la sonrisa gingival, movimiento dental con ortodoncia, cirugía de encías o de labio, o cirugía de mandíbula. Me han explicado estas opciones.'] },
        { h: 'Mis responsabilidades', list: [
          'Le he informado al doctor sobre mi historial médico, mis medicamentos y suplementos, mis alergias y cualquier tratamiento con toxina botulínica en los últimos 4 meses.',
          'No estoy embarazada ni amamantando (si aplica), y no tengo una enfermedad de los nervios o los músculos como miastenia gravis, síndrome de Lambert-Eaton o ELA.',
          'Seguiré las instrucciones de cuidado posterior y vendré a la cita de control de las 2 semanas.'
        ] }
      ],
      photos: 'Acepto que se tomen fotografías clínicas antes y después del tratamiento para mi expediente.',
      photosEdu: 'Acepto que mis fotografías, sin mostrar mi identidad, se usen con fines educativos o de mercadeo.',
      acknowledge: 'He leído este formulario o me lo han leído. He tenido la oportunidad de hacer preguntas y todas han sido respondidas. Doy mi consentimiento para el tratamiento con toxina botulínica por el Dr. Akhavan.',
      minor: 'Si el paciente es menor de 18 años, debe firmar uno de los padres o el tutor legal.',
      sigPatient: 'Firma del paciente o padre/tutor y fecha',
      sigName: 'Nombre en letra de molde y parentesco',
      sigWitness: 'Testigo',
      sigDoctor: 'Ortodoncista (Dr. Akhavan)'
    },
    screening: {
      title: 'Evaluación de salud para el tratamiento con toxina botulínica',
      sub: 'Por favor complétela antes de cada tratamiento',
      intro: 'Por favor responda todas las preguntas. Sus respuestas nos ayudan a decidir si el tratamiento es seguro para usted hoy.',
      q: [
        '¿Está embarazada, tratando de quedar embarazada o amamantando?',
        '¿Tiene alguna enfermedad de los nervios o los músculos (por ejemplo miastenia gravis, síndrome de Lambert-Eaton, ELA, esclerosis múltiple o parálisis de Bell)?',
        '¿Ha tenido dificultad para tragar, problemas para respirar (como asma o EPOC) o la voz débil?',
        '¿Tiene alguna enfermedad del corazón, o ha tenido un infarto o latidos irregulares?',
        '¿Ha tenido alguna reacción a Botox, Dysport, Xeomin, Jeuveau, Daxxify u otra toxina botulínica?',
        '¿Es alérgico(a) a la proteína de la leche de vaca o a la albúmina humana?',
        '¿Ha recibido toxina botulínica en cualquier parte del cuerpo (cosmética o médica) en los últimos 4 meses? Si es así: ¿dónde, cuándo y qué producto?',
        '¿Toma anticoagulantes, aspirina, ibuprofeno o naproxeno, aceite de pescado, vitamina E o ginkgo?',
        '¿Toma relajantes musculares, o antibióticos inyectados o por vena (por ejemplo gentamicina)?',
        '¿Toma medicamentos para la alergia o el resfriado, o para dormir?',
        '¿Tiene algún trastorno de sangrado o de coagulación, o le salen moretones con facilidad?',
        '¿Tiene una infección, fuego labial (herpes), sarpullido o una herida abierta cerca del área a tratar?',
        '¿Ha tenido cirugía facial, rellenos o problemas de los nervios de la cara?',
        '¿Tiene los párpados o las cejas caídos, u ojos secos?',
        '¿Toca un instrumento de viento o canta, o depende de movimientos precisos de los labios en su trabajo?',
        '¿Tiene un evento importante, fotos o un viaje en las próximas 2 semanas?',
        '¿Ha tenido un efecto secundario, o un resultado que no le gustó, en un tratamiento anterior?'
      ],
      meds: 'Medicamentos y suplementos que toma',
      allergies: 'Alergias',
      details: 'Detalles de cualquier respuesta “Sí”',
      confirm: 'Confirmo que esta información es completa y correcta.',
      sigPatient: 'Firma del paciente o padre/tutor y fecha',
      sigReviewed: 'Revisado por (doctor) y fecha'
    },
    aftercare: {
      title: 'Antes y después de su tratamiento con {p}',
      sub: 'Instrucciones de cuidado para la toxina botulínica',
      before: 'Antes de su cita',
      beforeList: [
        'Si su médico está de acuerdo, evite la aspirina, el ibuprofeno, el naproxeno, el aceite de pescado, la vitamina E y el ginkgo de 3 a 7 días antes del tratamiento para reducir la posibilidad de moretones. No deje de tomar los medicamentos que su médico le recetó (como anticoagulantes o aspirina diaria) sin consultarle primero.',
        'Evite el alcohol durante las 24 horas antes del tratamiento.',
        'Avísenos si está embarazada o amamantando, si se siente enfermo(a) o si empezó un medicamento nuevo.'
      ],
      after: 'Después del tratamiento: el primer día',
      afterList: [
        'No frote, masajee ni presione las áreas tratadas durante 24 horas.',
        'Permanezca erguido(a) (sin acostarse) durante 4 horas.',
        'Evite el ejercicio intenso, los jacuzzis, los saunas y los tratamientos faciales durante 24 horas.',
        'Una compresa fría por 10 minutos a la vez ayuda con la hinchazón o los moretones. Colóquela suavemente, sin presionar.',
        'Puede comer, hablar y regresar a la escuela o al trabajo de inmediato.',
        'Para el dolor de cabeza puede tomar acetaminofén (Tylenol), a menos que le hayan indicado no tomarlo.'
      ],
      expect: 'Qué esperar',
      expectList: [
        'El efecto empieza en 1 a 7 días y es completo en unas 2 semanas. Los cambios en la forma de la mandíbula empiezan a las 4 a 6 semanas y llegan a su máximo hacia los 3 meses.',
        'Músculos de la mandíbula: el hábito de apretar disminuye en 1 a 4 semanas. Los alimentos duros o chiclosos pueden cansar la mandíbula por unas semanas; corte la comida en pedazos más pequeños.',
        'Labios: beber con popote (pajilla), silbar y pronunciar algunos sonidos pueden sentirse diferentes por unas semanas.',
        'Frente: es común sentirla pesada o tensa durante la primera o segunda semana.',
        'Los resultados suelen durar de 3 a 4 meses, a menudo más en los músculos de la mandíbula.'
      ],
      follow: 'Su cita de control',
      followTxt: 'Por favor regrese en 2 semanas para que el doctor revise su resultado:',
      call: 'Llame a la oficina si',
      callList: [
        'los moretones o la hinchazón empeoran después de 2 días;',
        'nota un párpado o una ceja caídos cerca del área tratada y por lo demás se siente bien;',
        'tiene visión doble o borrosa: llame de inmediato y no maneje;',
        've señales de infección: enrojecimiento que se extiende, calor, pus o fiebre;',
        'el resultado se ve desigual y le molesta (se evalúa mejor en la cita de las 2 semanas).'
      ],
      emergTitle: 'Emergencia: llame al 911 o vaya a la sala de emergencias de inmediato',
      emergTxt: 'si en cualquier momento, durante las horas o semanas después del tratamiento, tiene dificultad para tragar, hablar o respirar; debilidad que se extiende más allá del área tratada; párpados caídos o visión doble o borrosa junto con cualquiera de estos síntomas; ronquera o pérdida de la voz; pérdida del control de la vejiga; o señales de una reacción alérgica (ronchas, hinchazón de la cara, los labios o la lengua, silbido al respirar). No maneje ni use maquinaria si su vista o su fuerza están afectadas.',
      office: 'Next Level Orthodontics: (352) 332-7466'
    }
  }
};

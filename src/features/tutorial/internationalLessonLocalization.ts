import type { AppLocale } from '../preferences/localization';
import type { Lesson, ServoLessonSection } from '../../data/challenges/lessons';
import type { CutterGridLesson, CutterGridLessonSection } from './cutterGridLessons';
import { buildConceptQuestion } from './lessonAssessments';

type CourseLocale = Exclude<AppLocale, 'en' | 'zh-CN' | 'zh-TW' | 'zh-HK'>;

export function isCourseLocale(locale: AppLocale): locale is CourseLocale {
  return locale === 'ja' || locale === 'ko' || locale === 'es' ||
    locale === 'fr' || locale === 'ru' || locale === 'de';
}

interface CourseCopy {
  gridNames: readonly string[];
  servoNames: readonly string[];
  sectionTitles: readonly string[];
  gridDescription: (name: string, example: string) => string;
  gridGoal: (example: string) => string;
  servoDescription: (name: string) => string;
  servoGoal: (commands: string) => string;
  sectionBodies: (name: string, description: string, goal: string, example: string) => readonly string[];
  question: (name: string) => string;
  falseOptions: readonly [string, string];
  practical: (goal: string) => string;
  joints: Readonly<Record<string, string>>;
  setCommand: (joint: string, angle: number) => string;
  directions: Readonly<Record<string, string>>;
  repeat: string;
  wait: string;
}

const sectionBodies = (
  fixed: readonly string[],
  name: string,
  description: string,
  goal: string,
  example: string,
): readonly string[] => [
  description, goal, ...fixed.slice(0, 4), example,
  fixed[4].replace('{example}', example), fixed[5],
  fixed[6].replace('{example}', example), ...fixed.slice(7, 16),
  fixed[18],
];

const COPY: Record<CourseLocale, CourseCopy> = {
  ja: makeCopy({
    gridNames: ['Grid 1 · 固定ワールド座標軸', 'Grid 2 · 移動距離', 'Grid 3 · 経路の繰り返し', 'Grid 4 · 掃引経路を確認', 'Grid 5 · 到達不能ノード', 'Grid 6 · 反対方向', 'Grid 7 · 経由点で待機', 'Grid 8 · 経路の順序', 'Grid 9 · プログラムの簡潔化', 'Grid 10 · 検証済みヘアカット'],
    servoNames: ['1 · 最初のカット', '2 · 掃引を延ばす', '3 · 10ボクセルの掃引', '4 · 境界を探す', '5 · 肘関節の作業帯', '6 · 手首関節の作業帯', '7 · 下側の帯で止める', '8 · 2本の作業帯'],
    sectionTitles: ['学ぶ理由', '到達目標', '基本原則', '実行時の規則', '安全規則', 'よくある誤り', '例を読む', '紙上で追跡', '実行前に予測', '例を作る', '表示を確認', 'ステップ実行', 'テストする', '最初の応用', '次の応用', 'デバッグ練習', '自力で挑戦', '言葉で説明', '別の経路へ応用', '最終確認'],
    gridDescription: (n, e) => `${n}では、固定ワールドグリッド上で「${e}」を使い、経路の組み立て方を学びます。`, gridGoal: (e) => `Blocklyで「${e}」を作り、予測した経路と実際のカッター軌跡を比較します。`, servoDescription: (n) => `${n}では、すべて90°のHome姿勢から絶対サーボ角度を指定します。`, servoGoal: (c) => `次の順に設定します：${c}。`,
    fixed: ['座標軸と関節角度を混同しないでください。', '命令は上から順に実行されます。', '実行前に経路全体の安全性が確認されます。', 'カメラの向きだけで動作を判断しないでください。', '(0, 0, 0)から「{example}」を紙上で追跡してください。', '終点とカッターが通る区間を先に書き出します。', 'Blocklyで「{example}」を組み立てます。', 'グリッド、計画経路、ライブ値を照合します。', 'リセット後に1回だけステップ実行し、変化した値を確認します。', '「テスト」で予測、切除数、最終状態を比較します。', '一つの値だけを変え、結果を予測してから再試行します。', '命令順を変えたときの経路差を確かめます。', 'エラー表示と強調されたブロックから原因を特定します。', 'ヒントを見ずに同じ目標を達成します。', '結果が変わった理由を一文で説明します。', 'より長いヘアカット経路へ同じ原則を適用します。', '「{name}」で最も重要な規則を自分の言葉で説明します。', '不要なブロックを除き、安全な順序を確認します。', 'このレッスンのプログラムを記憶から作り直し、結果を予測してから「テスト」で検証します。'],
    question: (n) => `「${n}」について正しい説明はどれですか。`, falseOptions: ['カメラを回すと、プログラムの座標軸も一緒に回転する。', 'コンパイルできれば、どの経路でも必ず安全に目標を切れる。'], practical: (g) => `${g} 自分でBlocklyプログラムを作り、「テスト」で達成してください。`, joints: { baseYaw: 'X · ベースヨー', shoulder: 'Y · 肩関節', elbow: 'Z · 肘関節', wrist: 'B · 手首関節' }, setCommand: (j, a) => `${j}を${a}°に設定`, directions: { Right: '右へ', Left: '左へ', Up: '上へ', Down: '下へ', Forward: '前へ', Backward: '後ろへ' }, repeat: '繰り返し', wait: '待機',
  }),
  ko: makeCopy({
    gridNames: ['Grid 1 · 고정 월드 좌표축', 'Grid 2 · 이동 거리', 'Grid 3 · 경로 반복', 'Grid 4 · 스윕 경로 확인', 'Grid 5 · 도달 불가 노드', 'Grid 6 · 반대 방향', 'Grid 7 · 경유점에서 대기', 'Grid 8 · 경로 순서', 'Grid 9 · 프로그램 간결화', 'Grid 10 · 검증된 헤어컷'], servoNames: ['1 · 첫 절단', '2 · 스윕 연장', '3 · 10복셀 스윕', '4 · 경계 찾기', '5 · 팔꿈치 작업 대역', '6 · 손목 작업 대역', '7 · 아래 대역에서 정지', '8 · 두 작업 대역'], sectionTitles: ['학습 이유', '학습 목표', '핵심 원리', '실행 규칙', '안전 규칙', '흔한 실수', '예제 읽기', '종이에서 추적', '실행 전 예측', '예제 만들기', '화면 정보 확인', '한 단계 실행', '테스트 실행', '첫 응용', '두 번째 응용', '디버깅 연습', '독립 과제', '말로 설명', '다른 경로에 적용', '최종 확인'], gridDescription: (n,e)=>`${n}에서는 고정 월드 그리드에서 ‘${e}’ 경로를 구성하는 법을 배웁니다.`, gridGoal:(e)=>`Blockly에서 ‘${e}’를 만들고 예상 경로와 실제 커터 궤적을 비교하세요.`, servoDescription:(n)=>`${n}에서는 모든 모터가 90°인 Home 자세에서 절대 서보 각도를 지정합니다.`, servoGoal:(c)=>`다음 순서로 설정하세요: ${c}.`, fixed:['좌표축과 관절 각도를 혼동하지 마세요.','명령은 위에서 아래로 실행됩니다.','실행 전에 전체 경로의 안전성을 확인합니다.','카메라 방향만 보고 움직임을 판단하지 마세요.','(0, 0, 0)에서 ‘{example}’를 종이에 추적하세요.','종점과 커터가 지나갈 구간을 먼저 적으세요.','Blockly에서 ‘{example}’를 만드세요.','그리드, 계획 경로와 실시간 값을 대조하세요.','초기화한 뒤 한 단계만 실행하고 바뀐 값을 확인하세요.','‘테스트’로 예측, 절단 수와 최종 상태를 비교하세요.','한 값만 바꾸고 결과를 예측한 뒤 다시 실행하세요.','명령 순서를 바꿨을 때 경로 차이를 확인하세요.','오류 메시지와 강조된 블록으로 원인을 찾으세요.','힌트 없이 같은 목표를 달성하세요.','결과가 달라진 이유를 한 문장으로 설명하세요.','같은 원리를 더 긴 헤어컷 경로에 적용하세요.','‘{name}’의 핵심 규칙을 자신의 말로 설명하세요.','불필요한 블록을 지우고 안전한 순서를 확인하세요.','이 수업의 프로그램을 기억으로 다시 만들고, 결과를 예측한 뒤 ‘테스트’로 검증하세요.'], question:(n)=>`‘${n}’에 대한 올바른 설명은 무엇인가요?`, falseOptions:['카메라를 돌리면 프로그램의 좌표축도 함께 회전한다.','컴파일되기만 하면 모든 경로가 안전하게 목표를 자른다.'], practical:(g)=>`${g} Blockly 프로그램을 직접 만들고 ‘테스트’로 통과하세요.`, joints:{baseYaw:'X · 베이스 요',shoulder:'Y · 어깨 관절',elbow:'Z · 팔꿈치 관절',wrist:'B · 손목 관절'}, setCommand:(j,a)=>`${j}를 ${a}°로 설정`, directions:{Right:'오른쪽',Left:'왼쪽',Up:'위',Down:'아래',Forward:'앞',Backward:'뒤'}, repeat:'반복',wait:'대기',
  }),
  es: makeCopy({
    gridNames:['Grid 1 · Ejes fijos del mundo','Grid 2 · Distancia de movimiento','Grid 3 · Repetir una ruta','Grid 4 · Observar el barrido','Grid 5 · Nodos inaccesibles','Grid 6 · Direcciones opuestas','Grid 7 · Pausa en un punto','Grid 8 · Orden de la ruta','Grid 9 · Simplificar el programa','Grid 10 · Corte certificado'], servoNames:['1 · Primer corte','2 · Ampliar el barrido','3 · Barrido de diez vóxeles','4 · Encontrar el borde','5 · Franja del codo','6 · Franja de la muñeca','7 · Detenerse en la franja inferior','8 · Dos franjas de trabajo'], sectionTitles:['Por qué importa','Objetivo','Principio básico','Regla de ejecución','Regla de seguridad','Error frecuente','Leer el ejemplo','Trazarlo en papel','Predecir antes de ejecutar','Construir el ejemplo','Revisar la interfaz','Usar Paso','Usar Probar','Primera variación','Segunda variación','Práctica de depuración','Reto independiente','Explicarlo con tus palabras','Aplicarlo a otra ruta','Comprobación final'], gridDescription:(n,e)=>`En ${n} aprenderás a construir «${e}» sobre la cuadrícula fija del mundo.`, gridGoal:(e)=>`Crea «${e}» en Blockly y compara tu predicción con la trayectoria real del cortador.`, servoDescription:(n)=>`En ${n} indicarás ángulos absolutos desde la posición Home, con todos los motores a 90°.`, servoGoal:(c)=>`Configura las articulaciones en este orden: ${c}.`, fixed:['No confundas los ejes de coordenadas con los ángulos articulares.','Las órdenes se ejecutan de arriba abajo.','La ruta completa se valida antes de mover el brazo.','No deduzcas el movimiento solo por la orientación de la cámara.','Parte de (0, 0, 0) y traza «{example}» en papel.','Anota primero el punto final y cada tramo barrido.','Construye «{example}» en Blockly.','Compara la cuadrícula, la ruta planificada y los valores en vivo.','Restablece y ejecuta un solo paso; identifica qué valor cambió.','Pulsa «Probar» y compara predicción, cortes y estado final.','Cambia un solo valor, predice el resultado y vuelve a probar.','Cambia el orden de dos órdenes y observa la diferencia de ruta.','Usa el error y el bloque resaltado para localizar la causa.','Alcanza el mismo objetivo sin consultar las pistas.','Explica en una frase por qué cambió el resultado.','Aplica la misma regla a una ruta de corte más larga.','Explica con tus palabras la regla principal de «{name}».','Elimina bloques innecesarios y confirma el orden seguro.','Reconstruye de memoria el programa de esta lección, predice el resultado y verifícalo con «Probar».'], question:(n)=>`¿Qué afirmación sobre «${n}» es correcta?`, falseOptions:['Al girar la cámara también giran los ejes del programa.','Todo programa que compila sigue una ruta segura y produce el corte previsto.'], practical:(g)=>`${g} Crea el programa por tu cuenta y supéralo con «Probar».`, joints:{baseYaw:'X · giro de la base',shoulder:'Y · hombro',elbow:'Z · codo',wrist:'B · muñeca'}, setCommand:(j,a)=>`fija ${j} en ${a}°`, directions:{Right:'Derecha',Left:'Izquierda',Up:'Arriba',Down:'Abajo',Forward:'Adelante',Backward:'Atrás'}, repeat:'Repetir',wait:'Esperar',
  }),
  fr: makeCopy({
    gridNames:['Grid 1 · Axes fixes du monde','Grid 2 · Distance de déplacement','Grid 3 · Répéter une trajectoire','Grid 4 · Observer le balayage','Grid 5 · Nœuds inaccessibles','Grid 6 · Directions opposées','Grid 7 · Pause à un point de passage','Grid 8 · Ordre de la trajectoire','Grid 9 · Simplifier le programme','Grid 10 · Coupe certifiée'], servoNames:['1 · Première coupe','2 · Prolonger le balayage','3 · Balayage de dix voxels','4 · Trouver le bord','5 · Bande du coude','6 · Bande du poignet','7 · Arrêt sur la bande inférieure','8 · Deux bandes de travail'], sectionTitles:['Pourquoi cette notion compte','Objectif','Principe essentiel','Règle d’exécution','Règle de sécurité','Erreur fréquente','Lire l’exemple','Tracer sur papier','Prédire avant l’exécution','Construire l’exemple','Lire l’interface','Utiliser le pas à pas','Utiliser Tester','Première variante','Deuxième variante','Exercice de débogage','Défi autonome','Expliquer avec vos mots','Transférer à une autre trajectoire','Vérification finale'], gridDescription:(n,e)=>`${n} vous apprend à construire « ${e} » dans le repère fixe du monde.`, gridGoal:(e)=>`Construisez « ${e} » dans Blockly, puis comparez votre prédiction à la trajectoire réelle du couteau.`, servoDescription:(n)=>`${n} utilise des angles absolus depuis la position Home, avec tous les moteurs à 90°.`, servoGoal:(c)=>`Réglez les articulations dans cet ordre : ${c}.`, fixed:['Ne confondez pas les axes de coordonnées et les angles articulaires.','Les commandes sont exécutées de haut en bas.','La trajectoire complète est validée avant le mouvement.','Ne déduisez pas le mouvement de la seule orientation de la caméra.','Partez de (0, 0, 0) et tracez « {example} » sur papier.','Notez d’abord le point final et chaque segment balayé.','Construisez « {example} » dans Blockly.','Comparez la grille, la trajectoire prévue et les valeurs en direct.','Réinitialisez, exécutez un seul pas et repérez la valeur modifiée.','Appuyez sur « Tester » et comparez prédiction, coupes et état final.','Modifiez une seule valeur, prédisez le résultat, puis testez à nouveau.','Inversez deux commandes et observez la différence de trajectoire.','Utilisez le message d’erreur et le bloc surligné pour trouver la cause.','Atteignez le même objectif sans consulter les indices.','Expliquez en une phrase pourquoi le résultat a changé.','Appliquez la même règle à une trajectoire de coupe plus longue.','Expliquez avec vos mots la règle principale de « {name} ».','Supprimez les blocs inutiles et confirmez l’ordre sûr.','Reconstruisez de mémoire le programme de cette leçon, prédisez le résultat et vérifiez-le avec « Tester ».'], question:(n)=>`Quelle affirmation sur « ${n} » est correcte ?`, falseOptions:['Faire pivoter la caméra fait aussi pivoter les axes du programme.','Tout programme qui compile suit nécessairement une trajectoire sûre et produit la coupe attendue.'], practical:(g)=>`${g} Construisez le programme vous-même et validez-le avec « Tester ».`, joints:{baseYaw:'X · lacet de la base',shoulder:'Y · épaule',elbow:'Z · coude',wrist:'B · poignet'}, setCommand:(j,a)=>`régler ${j} sur ${a}°`, directions:{Right:'Droite',Left:'Gauche',Up:'Haut',Down:'Bas',Forward:'Avant',Backward:'Arrière'}, repeat:'Répéter',wait:'Attendre',
  }),
  ru: makeCopy({
    gridNames:['Grid 1 · Фиксированные мировые оси','Grid 2 · Дистанция перемещения','Grid 3 · Повторение маршрута','Grid 4 · Контроль траектории резака','Grid 5 · Недостижимые узлы','Grid 6 · Противоположные направления','Grid 7 · Пауза в путевой точке','Grid 8 · Порядок маршрута','Grid 9 · Упрощение программы','Grid 10 · Проверенная стрижка'], servoNames:['1 · Первый срез','2 · Продлить движение','3 · Полоса из десяти вокселей','4 · Найти край','5 · Полоса локтя','6 · Полоса запястья','7 · Остановка на нижней полосе','8 · Две рабочие полосы'], sectionTitles:['Зачем это нужно','Цель урока','Основной принцип','Правило выполнения','Правило безопасности','Частая ошибка','Разбор примера','Трассировка на бумаге','Прогноз перед запуском','Сборка примера','Проверка интерфейса','Пошаговый запуск','Проверка программы','Первый вариант','Второй вариант','Отладка','Самостоятельное задание','Объяснение своими словами','Перенос на другой маршрут','Итоговая проверка'], gridDescription:(n,e)=>`В уроке «${n}» вы построите маршрут «${e}» в фиксированной мировой сетке.`, gridGoal:(e)=>`Соберите «${e}» в Blockly и сравните прогноз с реальной траекторией резака.`, servoDescription:(n)=>`В уроке «${n}» задаются абсолютные углы из Home-положения, где все приводы стоят на 90°.`, servoGoal:(c)=>`Задайте команды в таком порядке: ${c}.`, fixed:['Не смешивайте координатные оси и углы суставов.','Команды выполняются сверху вниз.','Весь маршрут проверяется до начала движения.','Не определяйте направление только по положению камеры.','Начните в (0, 0, 0) и проследите «{example}» на бумаге.','Сначала запишите конечную точку и все участки траектории.','Соберите «{example}» в Blockly.','Сопоставьте сетку, план и текущие значения.','Сбросьте состояние, выполните один шаг и найдите изменившееся значение.','Нажмите «Проверить» и сравните прогноз, срезы и итоговое состояние.','Измените одно значение, спрогнозируйте результат и повторите проверку.','Поменяйте две команды местами и сравните траектории.','Найдите причину по сообщению об ошибке и выделенному блоку.','Достигните той же цели без подсказок.','Одним предложением объясните, почему результат изменился.','Примените это правило к более длинному маршруту стрижки.','Объясните своими словами главное правило урока «{name}».','Удалите лишние блоки и проверьте безопасный порядок.','Восстановите программу этого урока по памяти, спрогнозируйте результат и проверьте её командой «Проверить».'], question:(n)=>`Какое утверждение об уроке «${n}» верно?`, falseOptions:['При повороте камеры оси программы поворачиваются вместе с ней.','Любая компилируемая программа обязательно безопасна и даёт нужный результат.'], practical:(g)=>`${g} Самостоятельно соберите программу и нажмите «Проверить».`, joints:{baseYaw:'X · рыскание основания',shoulder:'Y · плечо',elbow:'Z · локоть',wrist:'B · запястье'}, setCommand:(j,a)=>`установить ${j} на ${a}°`, directions:{Right:'Вправо',Left:'Влево',Up:'Вверх',Down:'Вниз',Forward:'Вперёд',Backward:'Назад'}, repeat:'Повторить',wait:'Ждать',
  }),
  de: makeCopy({
    gridNames:['Grid 1 · Feste Weltachsen','Grid 2 · Bewegungsdistanz','Grid 3 · Pfad wiederholen','Grid 4 · Überstrichenen Pfad prüfen','Grid 5 · Unerreichbare Knoten','Grid 6 · Gegenrichtungen','Grid 7 · Am Wegpunkt warten','Grid 8 · Pfadreihenfolge','Grid 9 · Programm vereinfachen','Grid 10 · Zertifizierter Haarschnitt'], servoNames:['1 · Erster Schnitt','2 · Schwenk verlängern','3 · Zehn-Voxel-Schwenk','4 · Rand finden','5 · Ellbogenband','6 · Handgelenkband','7 · Am unteren Band stoppen','8 · Zwei Arbeitsbänder'], sectionTitles:['Warum das wichtig ist','Lernziel','Grundprinzip','Ausführungsregel','Sicherheitsregel','Häufiger Fehler','Beispiel lesen','Auf Papier verfolgen','Vor dem Start vorhersagen','Beispiel bauen','Anzeige prüfen','Einzelschritt nutzen','Testen','Erste Variante','Zweite Variante','Debugging-Übung','Eigenständige Aufgabe','Mit eigenen Worten erklären','Auf einen anderen Pfad übertragen','Abschlussprüfung'], gridDescription:(n,e)=>`In ${n} baust du „${e}“ im festen Weltkoordinatenraster.`, gridGoal:(e)=>`Erstelle „${e}“ in Blockly und vergleiche deine Vorhersage mit der tatsächlichen Cutter-Trajektorie.`, servoDescription:(n)=>`In ${n} verwendest du absolute Servowinkel aus der Home-Stellung, in der alle Motoren auf 90° stehen.`, servoGoal:(c)=>`Setze die Gelenke in dieser Reihenfolge: ${c}.`, fixed:['Verwechsle Koordinatenachsen nicht mit Gelenkwinkeln.','Befehle werden von oben nach unten ausgeführt.','Der gesamte Pfad wird vor der Bewegung geprüft.','Leite die Richtung nicht allein aus der Kameraansicht ab.','Beginne bei (0, 0, 0) und verfolge „{example}“ auf Papier.','Notiere zuerst den Endpunkt und alle überstrichenen Abschnitte.','Baue „{example}“ in Blockly.','Vergleiche Raster, geplanten Pfad und Live-Werte.','Setze zurück, führe einen Schritt aus und finde den geänderten Wert.','Drücke „Testen“ und vergleiche Vorhersage, Schnitte und Endzustand.','Ändere nur einen Wert, sage das Ergebnis voraus und teste erneut.','Vertausche zwei Befehle und vergleiche die Pfade.','Finde die Ursache mithilfe der Fehlermeldung und des markierten Blocks.','Erreiche dasselbe Ziel ohne Hinweise.','Erkläre in einem Satz, warum sich das Ergebnis geändert hat.','Übertrage dieselbe Regel auf einen längeren Haarschnittpfad.','Erkläre die wichtigste Regel aus „{name}“ mit eigenen Worten.','Entferne unnötige Blöcke und prüfe die sichere Reihenfolge.','Baue das Programm dieser Lektion aus dem Gedächtnis nach, sage das Ergebnis voraus und prüfe es mit „Testen“.'], question:(n)=>`Welche Aussage zu „${n}“ ist richtig?`, falseOptions:['Beim Drehen der Kamera drehen sich auch die Programmakachsen.','Jedes kompilierbare Programm folgt garantiert einem sicheren Pfad und erzeugt den gewünschten Schnitt.'], practical:(g)=>`${g} Erstelle das Programm selbst und bestehe die Aufgabe mit „Testen“.`, joints:{baseYaw:'X · Basis-Gierwinkel',shoulder:'Y · Schulter',elbow:'Z · Ellbogen',wrist:'B · Handgelenk'}, setCommand:(j,a)=>`${j} auf ${a}° setzen`, directions:{Right:'Rechts',Left:'Links',Up:'Oben',Down:'Unten',Forward:'Vorwärts',Backward:'Rückwärts'}, repeat:'Wiederholen',wait:'Warten',
  }),
};

function makeCopy(input: Omit<CourseCopy, 'sectionBodies'> & { fixed: readonly string[] }): CourseCopy {
  return { ...input, sectionBodies: (n, d, g, e) => sectionBodies(input.fixed, n, d, g, e) };
}

function translateExample(example: string, copy: CourseCopy): string {
  let translated = example;
  for (const [source, target] of Object.entries(copy.directions)) translated = translated.replaceAll(source, target);
  return translated.replaceAll('Repeat', copy.repeat).replaceAll('Wait', copy.wait);
}

function localizedSections<T extends CutterGridLessonSection | ServoLessonSection>(sections: readonly T[], copy: CourseCopy, name: string, description: string, goal: string, example: string): T[] {
  const bodies = copy.sectionBodies(name, description, goal, example);
  return sections.map((section, index) => ({ ...section, title: copy.sectionTitles[index] ?? section.title, body: bodies[index] ?? goal }));
}

export function localizeInternationalGridLesson(lesson: CutterGridLesson, locale: CourseLocale): CutterGridLesson {
  const copy = COPY[locale];
  const index = GRID_IDS.indexOf(lesson.id);
  if (index < 0) return lesson;
  const name = copy.gridNames[index];
  const translatedExample = translateExample(lesson.example, copy);
  const example = translatedExample === lesson.example ? copy.gridNames[index] : translatedExample;
  const description = copy.gridDescription(name, example);
  const goal = copy.gridGoal(example);
  return { ...lesson, name, description, goal, assessments: { multipleChoice: { ...buildConceptQuestion(name, goal, lesson.assessments.multipleChoice.correctOptionIndex, copy.falseOptions), question: copy.question(name) }, practicalPrompt: copy.practical(goal) }, sections: localizedSections(lesson.sections, copy, name, description, goal, example) };
}

export function localizeInternationalServoLesson(lesson: Lesson, locale: CourseLocale): Lesson {
  const copy = COPY[locale];
  const index = SERVO_IDS.indexOf(lesson.id);
  if (index < 0) return lesson;
  const name = copy.servoNames[index];
  const commands = lesson.solution.map(({ jointId, angleDeg }) => copy.setCommand(copy.joints[jointId] ?? jointId, angleDeg)).join(' → ');
  const description = copy.servoDescription(name);
  const goal = copy.servoGoal(commands);
  return { ...lesson, name, description, goal, assessments: { multipleChoice: { ...buildConceptQuestion(name, goal, lesson.assessments.multipleChoice.correctOptionIndex, copy.falseOptions), question: copy.question(name) }, practicalPrompt: copy.practical(goal) }, sections: localizedSections(lesson.sections, copy, name, description, goal, commands) };
}

const GRID_IDS = ['cutter-grid-fixed-axes','cutter-grid-distance','cutter-grid-repeat','cutter-grid-overcut','cutter-grid-blocked','cutter-grid-opposites','cutter-grid-wait','cutter-grid-route-order','cutter-grid-compress','cutter-grid-certified-cut'];
const SERVO_IDS = ['lesson-1-first-cut','lesson-2-clear-the-head','lesson-3-shoulder','lesson-4-elbow','lesson-5-wrist','lesson-6-stop-short','lesson-7-narrow-band','lesson-8-full-cut'];

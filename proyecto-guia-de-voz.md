# Proyecto: capa de navegación conversacional para apps

**Hackathon:** AssemblyAI Voice Agent Hackathon (lablab.ai)
**Fechas:** 1 al 30 de septiembre de 2026
**Deadline real:** 30 de sep, 9:00 AM hora de Mérida. O sea, el último día completo de trabajo es el 29.
**Premios:** 5 ganadores, cada uno se lleva $1,000 en efectivo más $1,000 en créditos de API.

---

## La idea en una línea

**Tu app responde preguntas señalando, no escribiendo.**

---

## El problema

Cuando alguien no sabe usar una parte de un dashboard hoy tiene tres opciones, y las tres son malas:

1. **El tour de bienvenida.** Corre una vez, el día uno, cuando el usuario todavía no sabe qué necesita. La mayoría lo salta. Y aunque lo vea, tres días después no se acuerda del paso 4.
2. **El chat de soporte.** Le responde con un texto tipo "ve a Configuración, luego a Equipo, luego al botón de arriba a la derecha". El usuario tiene que traducir esas instrucciones a la pantalla que tiene enfrente. Muchas veces no las encuentra igual.
3. **Abrir un ticket.** Caro para la empresa, lento para el usuario.

El patrón de fondo: la información de cómo usar la app está separada de la app. Siempre hay que traducir de un lado al otro.

## La solución

Un widget que vive permanentemente dentro de la app. El usuario lo abre, pregunta en voz alta "¿cómo agrego a alguien de mi equipo?", y pasan tres cosas:

1. El agente lo lleva a la pantalla correcta.
2. La pantalla se oscurece y se ilumina el botón exacto que tiene que presionar.
3. El agente le explica en voz qué está viendo y qué sigue.

Y lo más importante: **si el usuario le pica a otra cosa, el agente se da cuenta y lo corrige hablando.** "Eso te lleva a facturación, lo que buscas está más abajo."

Eso último es lo que nos separa de todo lo que ya existe.

## Por qué esto no es "un tour con voz"

Ya existen librerías de tours guiados desde hace años: Intro.js, Shepherd.js, Driver.js. Y empresas grandes como WalkMe, Pendo y Appcues.

Todas tienen la misma limitación: **son scripts, no agentes.** Alguien escribió los pasos a mano, en orden, de antemano. Si el usuario se sale del guion, el tour se rompe.

Lo nuestro es distinto en tres cosas:

| | Tours tradicionales | Nosotros |
|---|---|---|
| Cómo se configura | Un dev escribe cada paso a mano | Se escanea la app y se genera solo |
| Cuándo corre | Una vez, el día uno | Siempre disponible, cuando el usuario pregunte |
| Qué maneja | Un flujo fijo, en orden | Cualquier pregunta, en cualquier orden |
| Si te desvías | Se rompe | Te corrige o se adapta |

## Decisión de diseño importante: NO bloqueamos la pantalla

Podríamos hacer que mientras el agente te guía no puedas picarle a nada más que al botón correcto. Decidimos que no, por tres razones:

1. **Se rompe en el primer desvío.** El usuario pregunta cómo invitar a alguien, y a medio camino se da cuenta de que primero necesita crear un rol. Si está bloqueado, no puede.
2. **No es nuestra app.** Estamos haciendo una librería que se instala en dashboards ajenos. Si bloqueamos todo y algo no estaba previsto en nuestro escaneo, dejamos al usuario preso en su propia herramienta de trabajo. Ninguna empresa seria instala algo que puede secuestrarle la interfaz.
3. **Nos quita nuestra mejor demostración.** Un tour donde no te puedes equivocar nunca tiene que demostrar que entiende. Queremos que el usuario se equivoque para que el agente lo corrija.

Visualmente se ve igual (todo oscuro menos el botón). Funcionalmente el resto sigue clickeable.

Única excepción: acciones destructivas o irreversibles. Ahí sí interceptamos y pedimos confirmación.

---

## Cómo funciona por dentro

Son tres piezas.

### 1. El CLI de escaneo (se corre una vez)

El desarrollador que instala nuestra librería corre un comando:

```
npx [nombre] scan --routes ./rutas.json
```

Lo que pasa:

- Se abre la app automáticamente con Playwright (una herramienta que controla navegadores).
- Se captura el **árbol de accesibilidad** de cada pantalla. Esto es importante: no leemos el HTML crudo, que es enorme y está lleno de basura. El árbol de accesibilidad es la versión limpia que usan los lectores de pantalla para personas ciegas. Trae el nombre y el propósito de cada botón, y es entre 10 y 100 veces más chico. Esta decisión sola es lo que hace que el proyecto sea viable.
- Un LLM etiqueta cada elemento: para qué sirve, con qué otras palabras lo podría llamar un usuario, cuándo se usa.
- Se genera un archivo `manifest.json` que el desarrollador guarda en su repositorio.

Ese archivo es chiquito y legible. El dev lo puede revisar y corregir a mano. Eso no es una debilidad, es una ventaja: no es magia opaca, es un archivo versionado como cualquier otro código.

### 2. El paquete de npm (el widget)

Es lo que el desarrollador instala en su app. Contiene:

- El widget flotante
- El overlay del spotlight (el efecto de oscurecer todo menos un elemento)
- El buscador de elementos en pantalla
- La conexión con el agente de voz

Detalles técnicos que importan:

- Usa **Shadow DOM**, para que nuestros estilos y los de la app del cliente no se peleen.
- El micrófono **no está escuchando todo el tiempo.** Se activa cuando el usuario abre el widget. Un micrófono siempre abierto en un dashboard corporativo es un "no" inmediato de cualquier comprador.
- **Funciona sin voz.** Si el usuario niega el micrófono o está en una oficina ruidosa, hay un campo de texto. Mismo motor, mismo spotlight. Para el demo enseñamos voz, pero el fallback es lo que separa una librería usable de un juguete.

### 3. El backend (mínimo)

Solo dos endpoints:

- **Emitir tokens temporales.** AssemblyAI no permite poner la llave de API en el navegador, se la robarían. El backend emite tokens de corta duración. Aquí también es donde eventualmente se mediría el consumo para cobrar.
- **Recibir eventos.** Qué preguntó la gente, dónde se atoró. Esto a futuro es un producto aparte: le dices a la empresa qué partes de su app confunden a sus usuarios.

Nada de cuentas, ni dashboard, ni base de datos de usuarios. Eso es para después del hackathon.

---

## Qué usamos de AssemblyAI

Es requisito del hackathon construir sobre AssemblyAI. Usamos su **Voice Agent API**, que es el stack completo de voz en una sola conexión: escucha, entiende, decide y responde hablando. Incluye detección de turnos e interrupciones, y llamadas a herramientas.

Las "herramientas" son las funciones que el agente puede ejecutar en nuestro código:

- `navigate(ruta)` — llevar al usuario a la pantalla correcta
- `highlight(elemento)` — iluminar el botón
- `confirmAction(elemento)` — esperar a que el usuario realmente le pique

**Un beneficio grande que sale gratis:** el Voice Agent API soporta seis idiomas (inglés, español, francés, alemán, italiano, portugués) con cambio de idioma a media frase, sin configurar nada. Eso significa un solo manifiesto y onboarding en seis idiomas, sin escribir seis guiones ni contratar traductores. Para cualquier SaaS que esté entrando a Latinoamérica o Europa, eso hoy es un proyecto de semanas. Nosotros lo damos en cero.

---

## Por qué creemos que puede ganar

El hackathon califica cuatro cosas. Así estamos parados en cada una:

**Application of Technology (qué tan bien integramos el modelo).**
Fuerte. No es un chatbot con voz encima. Las llamadas a herramientas manipulan la interfaz en tiempo real, y el agente reacciona a lo que el usuario hace con el mouse.

**Business Value (impacto y valor práctico).**
Fuerte. El mercado ya existe y está probado: WalkMe y Pendo son empresas grandes vendiendo la versión vieja de esto. El comprador es cualquier SaaS con un dashboard. Se cobra por sitio o por consumo. El ahorro es medible en tickets de soporte que ya no se abren.

**Originality (qué tan único).**
Media-alta. Hacer preguntas abiertas y que la interfaz te conteste señalando no lo vende nadie hoy. Hay chatbots que te escriben instrucciones y hay agentes que hacen clic por ti. La cosa de en medio, que la app te enseñe dónde está para que tú lo hagas, no existe como producto.

**Presentation.**
Depende de nosotros. Es lo último que vamos a trabajar.

### El riesgo principal

Que un juez lo lea como "otro tour guiado, pero con voz". La defensa es el orden en que presentamos: **abrimos con la pregunta abierta y el spotlight respondiendo.** El tour lineal lo enseñamos al final, como un caso especial del mismo motor. Si abrimos con el tour lineal, nos encasillan y ya no salimos.

---

## Qué hay que entregar

Requisitos oficiales de la submission:

- Título y descripción
- Imagen de portada
- Video de pitch de máximo 5 minutos, en MP4
- Presentación en PDF
- Repositorio público en GitHub, con licencia MIT
- Demo funcionando en una URL a la que los jueces puedan entrar

Nota: el repo tiene que ser público y con licencia MIT, es regla del hackathon.

## Alcance para las 3 semanas

Lo que SÍ va:

- Soporte solo para React
- Una app de ejemplo desplegada donde cualquiera puede entrar y probar
- El CLI de escaneo funcionando
- El paquete publicado en npm de verdad
- Voz más fallback de texto

Lo que NO va (se menciona como roadmap en el pitch, no se construye):

- Crawler automático que descubra rutas solo. El dev le pasa la lista de rutas.
- Dashboard de analíticas
- Cuentas y facturación
- Soporte para Vue, Angular, etc.

**Un punto importante:** la app de ejemplo debe ser una app open source real, no un dashboard de juguete que hagamos nosotros. Que el escaneo funcione sobre código ajeno es la prueba de que esto es un framework y no una demo a la medida.

## Dónde está el trabajo difícil

Para que nadie se sorprenda:

1. **Que los selectores no se rompan.** Si el cliente le cambia el texto a un botón, nuestro manifiesto deja de encontrarlo. La solución es guardar varios puntos de referencia por elemento y buscar en cascada hasta que uno funcione. Este es el problema de ingeniería de verdad del proyecto.
2. **La corrección en vivo.** Detectar que el usuario se desvió y reaccionar en voz sin sonar molesto es más trabajo del que parece. Pero es donde está nuestra puntuación de originalidad.
3. **Los estados de la app.** Modales, popups, cosas que aparecen y desaparecen. El escaneo no los ve todos.

## Qué necesitamos

- Gente que le entre a React y TypeScript
- Alguien que ayude con el video de pitch y la presentación, que valen un cuarto de la calificación
- Alguien que pruebe el widget en apps distintas y reporte dónde se rompe

Los equipos pueden ser de 1 a 6 personas.

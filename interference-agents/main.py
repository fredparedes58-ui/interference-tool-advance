"""
main.py — Orquestador principal del sistema interference-agents
---------------------------------------------------------------
Coordina 4 agentes especializados para mantener y mejorar el
RF Interference Analysis Tool (backend Python + frontend TypeScript).

Agentes disponibles:
  classifier  → Firmas PRB, scorers, features de interferencia
  mitigation  → Catálogo de mitigaciones Ericsson
  topology    → Frontend React/TypeScript/MapLibre
  test        → pytest + tsc, validación de calidad

Uso:
  python main.py                          # Modo interactivo
  python main.py --task "descripción"     # Tarea directa
  python main.py --agent classifier       # Forzar agente específico
  python main.py --run-tests              # Correr todos los tests
"""

import asyncio
import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AgentDefinition,
    ClaudeSDKError,
    CLINotFoundError,
    ProcessError,
)
from claude_agent_sdk.types import (
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
)

from agents import (
    CLASSIFIER_AGENT,
    MITIGATION_AGENT,
    TOPOLOGY_AGENT,
    TEST_AGENT,
)

# ---------------------------------------------------------------------------
# Configuración
# ---------------------------------------------------------------------------

load_dotenv()

BASE_DIR = Path(__file__).parent.parent  # raíz del proyecto Interference tool

# Directorio de trabajo para cada agente
AGENT_CWD = {
    "classifier": str(BASE_DIR),
    "mitigation": str(BASE_DIR),
    "topology":   str(BASE_DIR / "topology-explorer"),
    "test":       str(BASE_DIR),
}

AGENT_DEFINITIONS: dict[str, AgentDefinition] = {
    "classifier": CLASSIFIER_AGENT,
    "mitigation": MITIGATION_AGENT,
    "topology":   TOPOLOGY_AGENT,
    "test":       TEST_AGENT,
}

# ---------------------------------------------------------------------------
# Prompt del orquestador
# ---------------------------------------------------------------------------

ORCHESTRATOR_SYSTEM = {
    "type": "preset",
    "preset": "claude_code",
    "append": """
Sos el orquestador del sistema de análisis de interferencia RF.

## Proyecto
RF Interference Analysis Tool — backend Python + frontend TypeScript

### Estructura
```
Interference tool/
├── interference_advisor/      # Paquete Python (clasificador, motor, modelos)
├── tests/                     # pytest (17 tests)
├── rules.yaml                 # Configuración de reglas
├── topology-explorer/         # Frontend React/TypeScript/MapLibre GL
│   └── src/
│       ├── classify.ts        # Puerto TS del clasificador Python
│       ├── types.ts
│       ├── App.tsx
│       └── components/
│           ├── CellAnalysisPanel.tsx
│           ├── MapView.tsx
│           └── ...
└── interference-agents/       # Este proyecto — sistema de agentes
```

## Agentes disponibles
- **classifier** — Firmas PRB, scorers, extract_prb_features, thresholds
- **mitigation** — Catálogo MITIGATIONS, features Ericsson (FAJ 121 XXXX)
- **topology**   — Frontend TypeScript, React components, MapLibre layers
- **test**       — pytest + tsc, calidad y regresión

## Reglas de orquestación
1. Analizá la tarea antes de delegarla — entendé qué archivos afecta
2. Para cambios en el clasificador, siempre delegá a "classifier" Y luego a "test"
3. Para cambios en el frontend, siempre terminá con "test" (tsc check)
4. Para cambios en mitigaciones, delegá a "mitigation" (Python) + "topology" (TypeScript)
5. Cuando la tarea afecte múltiples capas, coordiná en este orden:
   classifier → mitigation → topology → test
6. Reportá al usuario el resultado final con los archivos modificados

## Respuesta esperada al usuario
- Qué agente/s fueron usados
- Qué archivos fueron modificados
- Resultado de tests (si aplica)
- Próximos pasos sugeridos
""",
}

# ---------------------------------------------------------------------------
# Helpers de display
# ---------------------------------------------------------------------------

def print_separator(title: str = "") -> None:
    width = 60
    if title:
        pad = (width - len(title) - 2) // 2
        print(f"\n{'─' * pad} {title} {'─' * pad}")
    else:
        print("─" * width)


def display_message(message: AssistantMessage | ResultMessage) -> None:
    """Imprime mensajes del agente con formato legible."""
    if isinstance(message, AssistantMessage):
        for block in message.content:
            if isinstance(block, TextBlock) and block.text.strip():
                print(block.text)
            elif isinstance(block, ToolUseBlock):
                print(f"\n  🔧 [{block.name}]", end="")
                if hasattr(block, "input") and isinstance(block.input, dict):
                    # Mostrar solo los primeros campos del input para no saturar
                    preview = {k: str(v)[:80] for k, v in list(block.input.items())[:2]}
                    print(f" {preview}", end="")
                print()

    elif isinstance(message, ResultMessage):
        print_separator()
        status = "✅ OK" if not message.is_error else "❌ ERROR"
        print(f"  {status}  |  {message.duration_ms}ms  |  ${message.total_cost_usd:.4f}")
        if message.is_error:
            print(f"  Error: {getattr(message, 'error', 'desconocido')}")


# ---------------------------------------------------------------------------
# Lógica principal
# ---------------------------------------------------------------------------

async def run_task(task: str, forced_agent: str | None = None) -> None:
    """
    Ejecuta una tarea usando el orquestador.
    Si forced_agent está definido, el orquestador usará ese agente directamente.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("❌ ANTHROPIC_API_KEY no está configurada.")
        print("   Copiá .env.example a .env y agregá tu API key.")
        sys.exit(1)

    prompt = task
    if forced_agent and forced_agent in AGENT_DEFINITIONS:
        prompt = (
            f"Usá el agente '{forced_agent}' para completar esta tarea:\n\n{task}"
        )

    options = ClaudeAgentOptions(
        system_prompt=ORCHESTRATOR_SYSTEM,
        agents=AGENT_DEFINITIONS,
        allowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
        permission_mode="acceptEdits",
        cwd=str(BASE_DIR),
        model="claude-opus-4-5",
        max_turns=50,
    )

    print_separator("INTERFERENCE AGENTS — ORQUESTADOR")
    print(f"  Tarea: {prompt[:120]}{'...' if len(prompt) > 120 else ''}")
    print_separator()

    try:
        async with ClaudeSDKClient(options=options) as client:
            await client.query(prompt)
            async for message in client.receive_response():
                display_message(message)
    except CLINotFoundError:
        print("ERROR: Claude Code CLI no encontrado. Instala Claude Code primero.")
        sys.exit(1)
    except ProcessError as e:
        print(f"ERROR: El proceso falló — {e}")
        sys.exit(1)
    except ClaudeSDKError as e:
        print(f"ERROR del SDK: {e}")
        sys.exit(1)


async def run_tests() -> None:
    """Atajo rápido: delega todos los tests al test_agent."""
    task = (
        "Corré todos los tests del proyecto:\n"
        "1. pytest tests/ -v (backend Python)\n"
        "2. npx tsc -b --noEmit (frontend TypeScript)\n"
        "Reportá resultados completos y cualquier fallo con su causa."
    )
    await run_task(task, forced_agent="test")


async def interactive_mode() -> None:
    """Modo interactivo: loop de conversación con el orquestador."""
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("❌ ANTHROPIC_API_KEY no está configurada.")
        print("   Copiá .env.example a .env y agregá tu API key.")
        sys.exit(1)

    options = ClaudeAgentOptions(
        system_prompt=ORCHESTRATOR_SYSTEM,
        agents=AGENT_DEFINITIONS,
        allowed_tools=["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Agent"],
        permission_mode="acceptEdits",
        cwd=str(BASE_DIR),
        model="claude-opus-4-5",
        max_turns=50,
    )

    print_separator("INTERFERENCE AGENTS — MODO INTERACTIVO")
    print("  Escribi tu tarea y Enter. 'salir' o Ctrl+C para terminar.")
    print_separator()

    try:
        async with ClaudeSDKClient(options=options) as client:
            while True:
                try:
                    user_input = input("\nTarea: ").strip()
                except (KeyboardInterrupt, EOFError):
                    print("\n\nSesion terminada.")
                    break

                if user_input.lower() in ("salir", "exit", "quit", "q"):
                    print("Sesion terminada.")
                    break

                if not user_input:
                    continue

                await client.query(user_input)
                async for message in client.receive_response():
                    display_message(message)
    except CLINotFoundError:
        print("ERROR: Claude Code CLI no encontrado. Instala Claude Code primero.")
        sys.exit(1)
    except ProcessError as e:
        print(f"ERROR: El proceso fallo — {e}")
        sys.exit(1)
    except ClaudeSDKError as e:
        print(f"ERROR del SDK: {e}")
        sys.exit(1)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Interference Agents — orquestador de agentes especializados RF"
    )
    parser.add_argument(
        "--task", "-t",
        type=str,
        help="Tarea a ejecutar directamente (sin modo interactivo)",
    )
    parser.add_argument(
        "--agent", "-a",
        choices=list(AGENT_DEFINITIONS.keys()),
        help="Forzar uso de un agente específico",
    )
    parser.add_argument(
        "--run-tests",
        action="store_true",
        help="Correr todos los tests (pytest + tsc)",
    )
    args = parser.parse_args()

    if args.run_tests:
        asyncio.run(run_tests())
    elif args.task:
        asyncio.run(run_task(args.task, forced_agent=args.agent))
    else:
        asyncio.run(interactive_mode())


if __name__ == "__main__":
    main()

# interference-agents

Sistema de agentes especializados para el RF Interference Analysis Tool.

## Agentes

| Agente         | Responsabilidad                                              | Modelo  |
|----------------|--------------------------------------------------------------|---------|
| `classifier`   | Firmas PRB, scorers, features de interferencia               | sonnet  |
| `mitigation`   | Catálogo de mitigaciones Ericsson (FAJ 121 XXXX)             | sonnet  |
| `topology`     | Frontend React/TypeScript/MapLibre GL                        | sonnet  |
| `test`         | pytest + tsc, validación de calidad                          | sonnet  |
| Orquestador    | Coordina los 4 agentes, recibe tareas del usuario            | opus    |

## Setup

```bash
# 1. Crear entorno virtual (recomendado)
python -m venv .venv
.venv\Scripts\activate      # Windows
# source .venv/bin/activate  # Linux/Mac

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Configurar API key
copy .env.example .env
# Editar .env y poner tu ANTHROPIC_API_KEY
# Obtener key: https://console.anthropic.com/
```

## Uso

```bash
# Modo interactivo (recomendado)
python main.py

# Tarea directa
python main.py --task "Ajustá el scorer de PIM para mejorar la detección en B3"

# Forzar agente específico
python main.py --agent classifier --task "Revisá los thresholds del jammer"

# Correr todos los tests
python main.py --run-tests
```

## Ejemplos de tareas

```
# Clasificador
Agregá una nueva firma para interferencia de radar de aeropuerto en B28

# Mitigaciones
Actualizá el catálogo de BDA_EXCESS_GAIN con el feature FAJ 121 0484

# Frontend
Agregá un tooltip al PRB heatmap que muestre la hora y el valor en dBm

# Testing
Corré todos los tests y decime qué falló con su causa exacta

# Multi-agente (el orquestador coordina solo)
Mejoré la detección de PIM: ajustá el scorer, actualizá la mitigación y verificá que los tests pasen
```

## Estructura

```
interference-agents/
├── main.py                  # Orquestador principal
├── agents/
│   ├── __init__.py
│   ├── classifier_agent.py  # Especialista en firmas PRB
│   ├── mitigation_agent.py  # Especialista en mitigaciones Ericsson
│   ├── topology_agent.py    # Especialista en frontend TypeScript
│   └── test_agent.py        # Especialista en testing
├── requirements.txt
├── .env.example
└── .gitignore
```

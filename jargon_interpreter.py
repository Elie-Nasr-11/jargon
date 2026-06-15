"""Compatibility import for the Jargon interpreter.

The canonical engine lives in ``engine/jargon_interpreter.py``. This module
keeps older tests, tools, and notebooks that import ``jargon_interpreter``
working while the platform uses the ``engine/`` layout.
"""

from engine.jargon_interpreter import *  # noqa: F401,F403

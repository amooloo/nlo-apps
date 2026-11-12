"""NLO X-Ray Reader - local cephalometric tracing, measurements, skeletal class and CVM stage.

Everything runs on the office PC: images, tracings and the trained model never leave it. The one exception is the
AI summary (xray/ai_summary.py): on a click it sends the tracing's numbers - no name, dates or picture - to the
office's AISA.
"""
__version__ = "1.11.0"

"""
pdf_extraction_config.py
━━━━━━━━━━━━━━━━━━━━━━
Configuration management for PDF extraction strategies.
Stores settings for:
  • Which extraction method to use (pattern-based, AI-assisted, hybrid)
  • API keys and credentials
  • Vendor-specific PDF parsing templates
  • Quality thresholds for fallback triggering
"""

import json
import os
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict
from pathlib import Path


@dataclass
class PDFExtractionConfig:
    """Configuration for PDF extraction behavior."""

    # Extraction strategy: "pattern_based" | "ai_assisted" | "hybrid"
    strategy: str = "hybrid"

    # Whether to use Claude API for complex PDFs
    use_ai_fallback: bool = True

    # Anthropic API key (read from env if not set here)
    anthropic_api_key: Optional[str] = None

    # Quality thresholds for triggering AI fallback
    max_extracted_products: int = 100  # if more, likely duplicates
    min_sku_length: int = 3             # bogus SKUs shorter than this
    bogus_sku_ratio: float = 0.3        # if >30% SKUs are bogus, use AI

    # Column-based variant detection
    detect_columns: bool = True
    column_separator_pattern: str = r'\s{2,}|\|'  # regex for column split

    # Vendor-specific templates (can be extended)
    vendor_templates: Dict[str, Dict[str, Any]] = None

    # Logging / debugging
    verbose: bool = False
    save_intermediate_extractions: bool = False
    intermediate_dir: str = "/tmp/pdf_extractions"

    def __post_init__(self):
        if self.vendor_templates is None:
            self.vendor_templates = {}

    def get_anthropic_key(self) -> Optional[str]:
        """Get API key from config or environment."""
        if self.anthropic_api_key:
            return self.anthropic_api_key
        return os.environ.get('ANTHROPIC_API_KEY')

    def is_ai_available(self) -> bool:
        """Check if AI extraction is available (both SDK and API key)."""
        try:
            import anthropic  # noqa: F401
            return bool(self.get_anthropic_key())
        except ImportError:
            return False

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to dict (excluding API keys)."""
        d = asdict(self)
        d['anthropic_api_key'] = '***' if d.get('anthropic_api_key') else None
        return d


class PDFConfigManager:
    """Manage PDF extraction configuration persistence."""

    DEFAULT_CONFIG_DIR = Path(os.path.expanduser("~/.ai-scraper"))

    def __init__(self, config_dir: Optional[Path] = None):
        self.config_dir = config_dir or self.DEFAULT_CONFIG_DIR
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.config_file = self.config_dir / "pdf_extraction.json"
        self._config: Optional[PDFExtractionConfig] = None

    def load(self) -> PDFExtractionConfig:
        """Load configuration from disk, or return defaults."""
        if self.config_file.exists():
            try:
                with open(self.config_file) as f:
                    data = json.load(f)
                    # Reconstruct config object
                    self._config = PDFExtractionConfig(**{
                        k: v for k, v in data.items()
                        if k in PDFExtractionConfig.__dataclass_fields__
                    })
                    return self._config
            except Exception as e:
                print(f"Error loading config: {e}. Using defaults.")

        # Return default
        self._config = PDFExtractionConfig()
        return self._config

    def save(self, config: PDFExtractionConfig) -> None:
        """Save configuration to disk."""
        try:
            with open(self.config_file, 'w') as f:
                json.dump(asdict(config), f, indent=2)
            self._config = config
        except Exception as e:
            print(f"Error saving config: {e}")

    def get(self) -> PDFExtractionConfig:
        """Get current config (load if not cached)."""
        if self._config is None:
            self.load()
        return self._config

    def update(self, **kwargs) -> PDFExtractionConfig:
        """Update config with new values and save."""
        config = self.get()
        for key, value in kwargs.items():
            if hasattr(config, key):
                setattr(config, key, value)
        self.save(config)
        return config

    def register_vendor_template(self, vendor_name: str, template: Dict[str, Any]) -> None:
        """Register a vendor-specific PDF parsing template."""
        config = self.get()
        config.vendor_templates[vendor_name] = template
        self.save(config)

    def get_vendor_template(self, vendor_name: str) -> Optional[Dict[str, Any]]:
        """Retrieve a registered vendor template."""
        config = self.get()
        return config.vendor_templates.get(vendor_name)


# Global instance
_manager: Optional[PDFConfigManager] = None


def get_config_manager() -> PDFConfigManager:
    """Get or create global config manager."""
    global _manager
    if _manager is None:
        _manager = PDFConfigManager()
    return _manager


def get_pdf_config() -> PDFExtractionConfig:
    """Get current PDF extraction config."""
    return get_config_manager().load()


def update_pdf_config(**kwargs) -> PDFExtractionConfig:
    """Update PDF extraction config."""
    return get_config_manager().update(**kwargs)

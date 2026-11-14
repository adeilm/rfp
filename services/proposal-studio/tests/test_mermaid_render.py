"""POST /api/render/mermaid: the architecture diagram's Mermaid text drawn as SVG by the vendored mermaid.js."""
import unittest

import mermaid_render


class MermaidRenderTests(unittest.TestCase):
    def test_flowchart_becomes_svg_with_its_labels(self):
        svg = mermaid_render.render('flowchart LR\n  a["Portail"] -->|"lit"| b[("Entrepôt")]')
        self.assertIn("<svg", svg)
        self.assertIn("Portail", svg)
        self.assertNotIn("<script", svg.lower())

    def test_empty_or_oversized_text_is_refused(self):
        with self.assertRaises(ValueError):
            mermaid_render.render("  ")
        with self.assertRaises(ValueError):
            mermaid_render.render("flowchart LR\n" + "a-->b\n" * 5000)

    def test_invalid_mermaid_is_an_error_not_an_image(self):
        with self.assertRaises(RuntimeError):
            mermaid_render.render("this is not mermaid")


if __name__ == "__main__":
    unittest.main()

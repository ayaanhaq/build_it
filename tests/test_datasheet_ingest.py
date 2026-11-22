import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from datasheet_ingest import (
    DatasheetIngestor,
    DatasheetPage,
    IngestedDatasheet,
    compute_bytes_sha256,
    compute_file_sha256,
)


class DatasheetIngestTests(unittest.TestCase):
    def test_sha256_computation(self):
        sample = b"hello physical computing"
        expected = hashlib.sha256(sample).hexdigest()
        self.assertEqual(compute_bytes_sha256(sample), expected)

        with tempfile.NamedTemporaryFile("wb", delete=False) as f:
            f.write(sample)
            tmp_path = f.name

        try:
            self.assertEqual(compute_file_sha256(tmp_path), expected)
        finally:
            Path(tmp_path).unlink()

    def test_compute_file_sha256_missing_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            compute_file_sha256("/nonexistent/datasheet.pdf")

    def test_ingest_pdf_from_bytes_and_file(self):
        import pypdf

        writer = pypdf.PdfWriter()
        writer.add_blank_page(width=72, height=72)
        writer.add_blank_page(width=72, height=72)
        buf = io.BytesIO()
        writer.write(buf)
        pdf_bytes = buf.getvalue()

        ingestor = DatasheetIngestor(backend="pypdf")
        ingested = ingestor.extract_from_bytes(pdf_bytes, document_name="test.pdf")

        self.assertEqual(ingested.document_name, "test.pdf")
        self.assertEqual(ingested.page_count, 2)
        self.assertEqual(len(ingested.pages), 2)
        self.assertEqual(ingested.backend, "pypdf")
        self.assertEqual(ingested.sha256, hashlib.sha256(pdf_bytes).hexdigest())

        # Test from disk file
        with tempfile.NamedTemporaryFile("wb", suffix=".pdf", delete=False) as f:
            f.write(pdf_bytes)
            tmp_pdf = f.name

        try:
            doc = ingestor.ingest_pdf(tmp_pdf)
            self.assertEqual(doc.page_count, 2)
            self.assertEqual(doc.sha256, hashlib.sha256(pdf_bytes).hexdigest())
            self.assertTrue(Path(doc.document_path).is_file())
            self.assertIsInstance(doc.to_dict(), dict)
        finally:
            Path(tmp_pdf).unlink()

    def test_ingest_missing_file_raises(self):
        ingestor = DatasheetIngestor()
        with self.assertRaises(FileNotFoundError):
            ingestor.ingest_pdf("/nonexistent/fake_datasheet.pdf")

    def test_uninstalled_backend_raises_import_error(self):
        ingestor = DatasheetIngestor(backend="pymupdf")
        with self.assertRaises(ImportError) as ctx:
            ingestor.extract_from_bytes(b"%PDF-1.4 mock", "test.pdf")
        self.assertIn("PyMuPDF", str(ctx.exception))

        ingestor_plumber = DatasheetIngestor(backend="pdfplumber")
        with self.assertRaises(ImportError) as ctx2:
            ingestor_plumber.extract_from_bytes(b"%PDF-1.4 mock", "test.pdf")
        self.assertIn("pdfplumber", str(ctx2.exception))

    def test_page_text_helpers(self):
        pages = [
            DatasheetPage(page_number=1, text="Page 1 Content"),
            DatasheetPage(page_number=2, text="Page 2 Content"),
        ]
        doc = IngestedDatasheet(
            document_name="doc.pdf",
            document_path=None,
            sha256="abc",
            page_count=2,
            pages=pages,
        )
        self.assertEqual(doc.get_page_text(1), "Page 1 Content")
        self.assertEqual(doc.get_page_text(2), "Page 2 Content")
        self.assertEqual(doc.get_page_text(3), "")
        self.assertIn("Page 1 Content\n\nPage 2 Content", doc.full_text())


if __name__ == "__main__":
    unittest.main()

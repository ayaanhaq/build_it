import hashlib
import io
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


def compute_file_sha256(path: Union[str, Path]) -> str:
    """Compute the SHA-256 hex digest of a file in binary mode."""
    target_path = Path(path)
    if not target_path.is_file():
        raise FileNotFoundError(f"Datasheet file not found: {target_path}")

    hasher = hashlib.sha256()
    with open(target_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_bytes_sha256(data: bytes) -> str:
    """Compute the SHA-256 hex digest of bytes."""
    return hashlib.sha256(data).hexdigest()


@dataclass
class DatasheetPage:
    page_number: int
    text: str


@dataclass
class IngestedDatasheet:
    document_name: str
    document_path: Optional[str]
    sha256: str
    page_count: int
    pages: List[DatasheetPage] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    backend: str = "pypdf"

    def get_page_text(self, page_number: int) -> str:
        """Return text for a 1-indexed page number."""
        for p in self.pages:
            if p.page_number == page_number:
                return p.text
        return ""

    def full_text(self) -> str:
        """Concatenate all page text separated by double newlines."""
        return "\n\n".join(p.text for p in self.pages if p.text)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dictionary."""
        return asdict(self)


class DatasheetIngestor:
    """Ingests local PDF datasheets to extract per-page text and document metadata."""

    def __init__(self, backend: Optional[str] = "auto"):
        self.backend = backend or "auto"

    def _resolve_backend(self) -> str:
        if self.backend != "auto":
            return self.backend

        # Check pypdf first since it is currently installed in the environment
        try:
            import pypdf  # noqa: F401

            return "pypdf"
        except ImportError:
            pass

        # Check PyMuPDF (fitz)
        try:
            import fitz  # noqa: F401

            return "pymupdf"
        except ImportError:
            pass

        # Check pdfplumber
        try:
            import pdfplumber  # noqa: F401

            return "pdfplumber"
        except ImportError:
            pass

        return "unavailable"

    def ingest_pdf(self, path: Union[str, Path]) -> IngestedDatasheet:
        """Ingest a PDF from disk."""
        target_path = Path(path)
        if not target_path.exists():
            raise FileNotFoundError(f"PDF file does not exist: {target_path}")
        if not target_path.is_file():
            raise ValueError(f"Path is not a regular file: {target_path}")

        with open(target_path, "rb") as f:
            pdf_bytes = f.read()

        file_sha256 = compute_bytes_sha256(pdf_bytes)
        return self._extract_from_bytes(
            pdf_bytes,
            document_name=target_path.name,
            document_path=str(target_path.resolve()),
            sha256=file_sha256,
        )

    def extract_from_bytes(
        self, data: bytes, document_name: str = "in_memory.pdf"
    ) -> IngestedDatasheet:
        """Ingest a PDF directly from memory bytes."""
        sha256 = compute_bytes_sha256(data)
        return self._extract_from_bytes(
            data,
            document_name=document_name,
            document_path=None,
            sha256=sha256,
        )

    def _extract_from_bytes(
        self,
        data: bytes,
        document_name: str,
        document_path: Optional[str],
        sha256: str,
    ) -> IngestedDatasheet:
        backend = self._resolve_backend()

        if backend == "pypdf":
            return self._extract_with_pypdf(data, document_name, document_path, sha256)
        elif backend == "pymupdf":
            return self._extract_with_pymupdf(data, document_name, document_path, sha256)
        elif backend == "pdfplumber":
            return self._extract_with_pdfplumber(data, document_name, document_path, sha256)
        else:
            raise RuntimeError(
                f"No PDF extraction backend available (requested: '{backend}'). "
                "pypdf, PyMuPDF (fitz), or pdfplumber must be installed."
            )

    def _extract_with_pypdf(
        self,
        data: bytes,
        document_name: str,
        document_path: Optional[str],
        sha256: str,
    ) -> IngestedDatasheet:
        import pypdf

        reader = pypdf.PdfReader(io.BytesIO(data))
        pages: List[DatasheetPage] = []
        for i, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            pages.append(DatasheetPage(page_number=i, text=text))

        meta = {}
        if reader.metadata:
            for k, v in reader.metadata.items():
                if isinstance(v, str):
                    meta[str(k)] = v

        return IngestedDatasheet(
            document_name=document_name,
            document_path=document_path,
            sha256=sha256,
            page_count=len(reader.pages),
            pages=pages,
            metadata=meta,
            backend="pypdf",
        )

    def _extract_with_pymupdf(
        self,
        data: bytes,
        document_name: str,
        document_path: Optional[str],
        sha256: str,
    ) -> IngestedDatasheet:
        try:
            import fitz
        except ImportError as e:
            raise ImportError(
                "PyMuPDF (fitz) is not installed. To use this backend, ask the user before installing."
            ) from e

        doc = fitz.open(stream=data, filetype="pdf")
        pages: List[DatasheetPage] = []
        for i, page in enumerate(doc, start=1):
            pages.append(DatasheetPage(page_number=i, text=page.get_text() or ""))

        meta = dict(doc.metadata) if doc.metadata else {}
        page_count = len(doc)
        doc.close()

        return IngestedDatasheet(
            document_name=document_name,
            document_path=document_path,
            sha256=sha256,
            page_count=page_count,
            pages=pages,
            metadata=meta,
            backend="pymupdf",
        )

    def _extract_with_pdfplumber(
        self,
        data: bytes,
        document_name: str,
        document_path: Optional[str],
        sha256: str,
    ) -> IngestedDatasheet:
        try:
            import pdfplumber
        except ImportError as e:
            raise ImportError(
                "pdfplumber is not installed. To use this backend, ask the user before installing."
            ) from e

        with pdfplumber.open(io.BytesIO(data)) as pdf:
            pages: List[DatasheetPage] = []
            for i, page in enumerate(pdf.pages, start=1):
                pages.append(DatasheetPage(page_number=i, text=page.extract_text() or ""))
            meta = dict(pdf.metadata) if pdf.metadata else {}
            page_count = len(pdf.pages)

        return IngestedDatasheet(
            document_name=document_name,
            document_path=document_path,
            sha256=sha256,
            page_count=page_count,
            pages=pages,
            metadata=meta,
            backend="pdfplumber",
        )

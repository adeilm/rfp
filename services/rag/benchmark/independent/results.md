# Independent evaluation: results

20 verified requirement lines from 6 BOAMP tenders, company mode. Labels set before this run from the documents (an AI draft, checked by a second independent AI reviewer; rows where they disagree or the reviewer was unsure stay NEEDS_REVIEW and are not counted); the matching was not changed after it.

**Accuracy 0.80**

| Class | Support | Precision | Recall | F1 |
|---|---|---|---|---|
| covered | 3 | 0.75 | 1.00 | 0.86 |
| partial | 8 | 0.75 | 0.75 | 0.75 |
| missing | 9 | 0.88 | 0.78 | 0.82 |

Confusion matrix (rows: expected, columns: system)

| | covered | partial | missing |
|---|---|---|---|
| covered | 3 | 0 | 0 |
| partial | 1 | 6 | 1 |
| missing | 0 | 2 | 7 |

Errors: {'None': 16, 'Incorrect Partial': 1, 'False Positive': 2, 'False Negative': 1}

Evidence: the system's lead document is one the person named on 3 of 10 rows both call covered or partial.
Retrieval (rows with expected documents, n=10): P@3 0.20, R@3 0.30.

By language: en 0.67 (n=6), fr 0.86 (n=14)

| Req | Requirement | Expected | System | System document | Error |
|---|---|---|---|---|---|
| I01 | Fourniture, déploiement et maintenance d'une solution CRM | covered | covered | olivesoft_Project_Story_Fashion_CRM | None |
| I02 | marketing automation | partial | covered | CV_08_Lucas_Reed.pdf | Incorrect Partial |
| I03 | Provide a list of comparable services performed over the last 3 years | missing | missing |  | None |
| I05 | Corrective | missing | missing |  | None |
| I06 | preventive | missing | missing |  | None |
| I07 | adaptive | missing | missing |  | None |
| I08 | evolutionary maintenance | missing | partial | CV_09_Emma_Foster.pdf | False Positive |
| I09 | sécurisation et résilience des infrastructures | partial | partial | CV_03_Maya_Patel.pdf | None |
| I10 | cartographie des systèmes d'information | partial | partial | olivesoft_Project_Story_Unified_HR | None |
| I11 | sensibilisation et campagne de phishing | missing | missing |  | None |
| I12 | solutions de gestion de crise et collaborative | missing | missing |  | None |
| I13 | sites et extranets sous Typo3 et Symfony | partial | partial | CV_01_Ava_Thompson.pdf | None |
| I14 | développement web | covered | covered | CV_02_Liam_Carter.pdf | None |
| I17 | Hébergement, infogérance, sécurisation et maintenance logicielle de la plateforme technique | partial | partial | CV_03_Maya_Patel.pdf | None |
| I18 | Tierce Maintenance Applicative (TMA) du parc applicatif Low Code Outsystems | partial | partial | CV_09_Emma_Foster.pdf | None |
| I19 | assistance à la recette | covered | covered | CV_12_Mateo_Silva.pdf | None |
| I20 | sécurité des systèmes d'information | partial | partial | CV_03_Maya_Patel.pdf | None |
| I21 | optimisation de l'architecture | partial | missing |  | False Negative |
| I22 | Hébergement du système billettique | missing | partial | CV_14_Henry_Price.pdf | False Positive |
| I23 | administration technique et fonctionnelle du système billettique | missing | missing |  | None |

Small set (20 lines): a single line moves accuracy by 5 points. Read the errors, not only the rates.
